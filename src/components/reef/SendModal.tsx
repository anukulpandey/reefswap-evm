import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useState, useEffect } from 'react';
import { type Token } from '@/lib/mockData';
import { useBalanceVisibility } from '@/contexts/BalanceVisibilityContext';
import { useSendTransaction, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import { isAddress, parseUnits } from 'viem';
import { Loader2, ArrowUpRight } from 'lucide-react';
import UiKit from '@reef-chain/ui-kit';
import { erc20Abi } from '@/lib/abi';

interface SendModalProps {
  isOpen: boolean;
  onClose: () => void;
  token: Token | null;
}

const SendModal = ({ isOpen, onClose, token }: SendModalProps) => {
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [submittedHash, setSubmittedHash] = useState<`0x${string}` | undefined>(undefined);
  const { showBalances } = useBalanceVisibility();

  const {
    sendTransactionAsync,
    isPending: isSendingNative,
    reset: resetNativeSend,
    error: nativeSendError,
  } = useSendTransaction();

  const {
    writeContractAsync,
    isPending: isSendingToken,
    reset: resetTokenSend,
    error: tokenSendError,
  } = useWriteContract();

  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    error: confirmError,
  } = useWaitForTransactionReceipt({ hash: submittedHash });

  const isSending = isSendingNative || isSendingToken;
  const isProcessing = isSending || isConfirming;

  useEffect(() => {
    if (isConfirmed && submittedHash) {
      UiKit.notify.success({
        message: `Transaction Confirmed\nSent ${amount} ${token?.symbol}. Tx: ${submittedHash.slice(0, 10)}...`,
      });
      setRecipient('');
      setAmount('');
      setSubmittedHash(undefined);
      resetNativeSend();
      resetTokenSend();
      onClose();
    }
  }, [amount, isConfirmed, onClose, resetNativeSend, resetTokenSend, submittedHash, token?.symbol]);

  useEffect(() => {
    const error = nativeSendError || tokenSendError || confirmError;
    if (error) {
      const msg = error.message?.includes('User rejected')
        ? 'Transaction rejected by user'
        : error.message?.split('\n')[0] || 'Transaction failed';
      UiKit.notify.danger({
        message: `Transaction Failed\n${msg}`,
      });
      setSubmittedHash(undefined);
      resetNativeSend();
      resetTokenSend();
    }
  }, [confirmError, nativeSendError, resetNativeSend, resetTokenSend, tokenSendError]);

  const handleSend = async () => {
    if (!token || hasErrors || !recipient || !amount) return;

    try {
      const decimals = token.decimals ?? 18;
      const value = parseUnits(amount, decimals);

      if (token.isNative) {
        const hash = await sendTransactionAsync({
          to: recipient as `0x${string}`,
          value,
        });
        setSubmittedHash(hash);
        return;
      }

      if (!token.address) {
        UiKit.notify.danger({ message: 'Token address is missing for this asset.' });
        return;
      }

      const hash = await writeContractAsync({
        address: token.address,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [recipient as `0x${string}`, value],
      });
      setSubmittedHash(hash);
    } catch {
      // handled by hook error state effect
    }
  };

  const handleClose = () => {
    if (!isProcessing) {
      setRecipient('');
      setAmount('');
      setSubmittedHash(undefined);
      resetNativeSend();
      resetTokenSend();
      onClose();
    }
  };

  const handleMax = () => {
    setAmount(token?.balance.toString() || '0');
  };

  if (!token) return null;

  const formatBalance = (val: number) =>
    new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 6 }).format(val);

  const numAmount = parseFloat(amount);
  const amountExceedsBalance = amount !== '' && numAmount > token.balance;
  const amountIsNegative = amount !== '' && numAmount < 0;
  const amountIsZero = amount !== '' && numAmount === 0;
  const recipientInvalid = recipient !== '' && !isAddress(recipient);
  const hasAmountError = amountExceedsBalance || amountIsNegative || amountIsZero;
  const hasErrors = hasAmountError || recipientInvalid;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-md bg-[#f6f3fb] rounded-3xl border-0 p-0 overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-6 pt-6 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white/70 shadow-sm flex items-center justify-center">
              {token.icon === 'reef' ? (
                <UiKit.ReefIcon className="h-6 w-6 text-[#7a3bbd]" />
              ) : (
                <span className="text-lg">{token.icon}</span>
              )}
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[#1b1530]">Send {token.symbol}</h2>
              <p className="text-xs text-[#8e899c]">Transfer tokens to another address</p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 pb-6 space-y-4">
          {/* Amount Card */}
          <div className={`bg-white/70 rounded-2xl p-4 shadow-sm border transition-colors ${hasAmountError ? 'border-red-400' : 'border-[#ebe6f4]'}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-[#8e899c] uppercase tracking-wide">Amount</span>
              <button
                onClick={handleMax}
                disabled={isProcessing}
                className="text-xs font-semibold text-[#a93185] hover:text-[#8f2fb4] transition-colors disabled:opacity-50"
              >
                MAX
              </button>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="number"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={isProcessing}
                className={`flex-1 bg-transparent text-2xl font-semibold placeholder:text-[#c5c0d0] outline-none disabled:opacity-50 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${hasAmountError ? 'text-red-500' : 'text-[#1b1530]'}`}
              />
              <div className="flex items-center gap-1.5 rounded-full bg-[#f1edf8] px-3 py-1.5">
                {token.icon === 'reef' ? (
                  <UiKit.ReefIcon className="h-4 w-4 text-[#7a3bbd]" />
                ) : (
                  <span className="text-sm">{token.icon}</span>
                )}
                <span className="text-sm font-semibold text-[#1b1530]">{token.symbol}</span>
              </div>
            </div>
            <div className="flex items-center justify-between mt-2">
              <p className="text-xs text-[#8e899c]">
                Balance: {showBalances ? `${formatBalance(token.balance)} ${token.symbol}` : '••••••'}
              </p>
              {amountExceedsBalance && (
                <p className="text-xs font-medium text-red-500">Insufficient balance</p>
              )}
              {amountIsNegative && (
                <p className="text-xs font-medium text-red-500">Amount must be positive</p>
              )}
              {amountIsZero && (
                <p className="text-xs font-medium text-red-500">Enter an amount</p>
              )}
            </div>
          </div>

          {/* Recipient Card */}
          <div className={`bg-white/70 rounded-2xl p-4 shadow-sm border transition-colors ${recipientInvalid ? 'border-red-400' : 'border-[#ebe6f4]'}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-[#8e899c] uppercase tracking-wide">Recipient</span>
              {recipientInvalid && (
                <span className="text-xs font-medium text-red-500">Invalid address</span>
              )}
            </div>
            <input
              placeholder="0x..."
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              disabled={isProcessing}
              className={`w-full bg-transparent text-sm font-medium placeholder:text-[#c5c0d0] outline-none font-mono disabled:opacity-50 ${recipientInvalid ? 'text-red-500' : 'text-[#1b1530]'}`}
            />
          </div>

          {/* Send Button */}
          <Button
            className="w-full rounded-2xl py-6 text-base font-semibold bg-gradient-to-r from-[#a93185] to-[#5d3bad] text-white shadow-md hover:shadow-lg transition-shadow"
            onClick={handleSend}
            disabled={!recipient || !amount || isProcessing || hasErrors}
          >
            {isSending ? (
              <><Loader2 className="w-5 h-5 animate-spin mr-2" /> Waiting for approval...</>
            ) : isConfirming ? (
              <><Loader2 className="w-5 h-5 animate-spin mr-2" /> Confirming on chain...</>
            ) : (
              <><ArrowUpRight className="w-5 h-5 mr-2" /> Send {token.symbol}</>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SendModal;
