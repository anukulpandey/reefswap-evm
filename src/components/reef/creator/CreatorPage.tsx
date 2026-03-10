import React, { useMemo, useState } from 'react';
import Uik from '@reef-chain/ui-kit';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import { getAddress, parseUnits, type Address, type Hex } from 'viem';
import './creator.css';
import IconUpload from './IconUpload';
import ConfirmToken from './ConfirmToken';
import { reefChain } from '../../../lib/config';
import type { TokenOption } from '../../../lib/tokens';
import { getErrorMessage, shortAddress } from '../../../lib/utils';
import { deployTokens, type DeployContractData } from './tokensDeployData';

type CreatorPageProps = {
  onTokenCreated?: (token: TokenOption) => void;
  onCreatePool?: () => void;
};

type ResultMessage = {
  complete: boolean;
  title: string;
  message: string;
  contractAddress?: Address;
  txHash?: Address;
};

const selectDeployData = (burnable: boolean, mintable: boolean): DeployContractData => {
  if (!burnable && !mintable) return deployTokens.noMintNoBurn;
  if (burnable && !mintable) return deployTokens.noMintBurn;
  if (!burnable && mintable) return deployTokens.mintNoBurn;
  return deployTokens.mintBurn;
};

const CreatorPage = ({ onTokenCreated, onCreatePool }: CreatorPageProps): JSX.Element => {
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient({ chainId: reefChain.id });
  const { data: walletClient } = useWalletClient({ chainId: reefChain.id });

  const [tokenName, setTokenName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [initialSupply, setInitialSupply] = useState('');
  const [burnable, setBurnable] = useState(true);
  const [mintable, setMintable] = useState(true);
  const [icon, setIcon] = useState('');
  const [isConfirmOpen, setConfirmOpen] = useState(false);
  const [resultMessage, setResultMessage] = useState<ResultMessage | null>(null);

  const validationMsg = useMemo(() => {
    if (!tokenName.trim()) return 'Set token name';
    if (!symbol.trim()) return 'Set token symbol';
    if (!initialSupply.trim()) return 'Set initial supply';
    const n = parseInt(initialSupply, 10);
    if (!Number.isInteger(n) || n <= 0) return 'Initial supply must be a positive whole number';
    try {
      parseUnits(initialSupply, 18);
    } catch {
      return 'Initial supply is too large';
    }
    return '';
  }, [tokenName, symbol, initialSupply]);

  const handleSupplyInput = (value = '') => {
    setInitialSupply(value.replace(/[^0-9]/g, ''));
  };

  const resetCreator = () => {
    setTokenName('');
    setSymbol('');
    setInitialSupply('');
    setBurnable(true);
    setMintable(true);
    setIcon('');
    setResultMessage(null);
  };

  const handleConfirm = async () => {
    if (validationMsg) return;
    if (!address || !walletClient || !publicClient) {
      Uik.notify.danger({ message: 'Wallet is not connected to Reef chain RPC.' });
      return;
    }
    if (chainId !== reefChain.id) {
      Uik.notify.danger({ message: `Switch wallet to Reef chain (${reefChain.id}) before creating token.` });
      return;
    }

    const safeName = tokenName.trim();
    const safeSymbol = symbol.trim().toUpperCase();
    const deployData = selectDeployData(burnable, mintable);

    setResultMessage({
      complete: false,
      title: 'Deploying token',
      message: 'Sending token contract transaction for signing.',
    });

    try {
      const hash = await walletClient.deployContract({
        account: address,
        chain: reefChain,
        abi: deployData.metadata.output.abi,
        bytecode: `0x${deployData.bytecode.object}` as Hex,
        args: [safeName, safeSymbol, parseUnits(initialSupply, 18)],
      });

      setResultMessage({
        complete: false,
        title: 'Deploying token',
        message: `Transaction submitted (${shortAddress(hash)}). Waiting for confirmation.`,
        txHash: hash,
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const createdAddress = receipt.contractAddress ? getAddress(receipt.contractAddress) : null;
      if (!createdAddress) {
        throw new Error('Token deployment confirmed but contract address was not returned.');
      }

      const createdToken: TokenOption = {
        symbol: safeSymbol,
        name: safeName,
        decimals: 18,
        address: createdAddress,
        isNative: false,
        iconUrl: icon || null,
      };
      onTokenCreated?.(createdToken);

      setResultMessage({
        complete: true,
        title: 'Token created',
        message: `Success, ${safeName} (${safeSymbol}) deployed with initial supply ${initialSupply}.`,
        contractAddress: createdAddress,
        txHash: hash,
      });
      Uik.notify.success({ message: `Token created at ${shortAddress(createdAddress)}` });
    } catch (error) {
      const message = getErrorMessage(error);
      setResultMessage({
        complete: true,
        title: 'Error creating token',
        message,
      });
      Uik.notify.danger({ message });
    }
  };

  const explorerBaseUrl = reefChain.blockExplorers.default.url.replace(/\/+$/, '');
  const resultContractUrl = resultMessage?.contractAddress ? `${explorerBaseUrl}/contract/${resultMessage.contractAddress}` : '';
  const resultTxUrl = resultMessage?.txHash ? `${explorerBaseUrl}/extrinsic/${resultMessage.txHash}` : '';

  return (
    <>
      {!resultMessage ? (
        <div className="creator">
          <div className="creator__form">
            <div className="creator__intro">
              <div className="creator__intro-copy">
                <h1 className="creator__title">Create your token</h1>
                <p className="creator__subtitle">Use Reef chain to create your own token.</p>
              </div>
              <IconUpload value={icon} onChange={setIcon} />
            </div>

            <Uik.Form>
              <Uik.Container className="creator__form-main">
                <Uik.Input
                  label="Token name"
                  placeholder="My Token"
                  value={tokenName}
                  maxLength={42}
                  onInput={(e) => setTokenName((e.target as HTMLInputElement).value)}
                />
                <Uik.Input
                  className="creator__token-symbol-input"
                  label="Token symbol"
                  placeholder="MYTKN"
                  value={symbol}
                  maxLength={42}
                  onInput={(e) => setSymbol((e.target as HTMLInputElement).value)}
                />
              </Uik.Container>

              <Uik.Input
                label="Initial supply"
                placeholder="0"
                value={initialSupply}
                min={1}
                onInput={(e) => handleSupplyInput((e.target as HTMLInputElement).value)}
              />

              <Uik.Container className="creator__form-bottom">
                <Uik.Toggle
                  label="Burnable"
                  onText="Yes"
                  offText="No"
                  value={burnable}
                  onChange={() => setBurnable((v) => !v)}
                />
                <Uik.Toggle
                  label="Mintable"
                  onText="Yes"
                  offText="No"
                  value={mintable}
                  onChange={() => setMintable((v) => !v)}
                />
              </Uik.Container>
            </Uik.Form>
          </div>

          <div className="creator__preview">
            <h2 className="creator__preview-title">Token Preview</h2>

            <div className="creator__preview-token">
              <div className="creator__preview-token-image">
                {icon ? (
                  <img src={icon} alt="Token icon" key={icon} />
                ) : null}
              </div>
              <div className="creator__preview-token-info">
                <div className="creator__preview-token-name">{tokenName || ' '}</div>
                <div className="creator__preview-token-symbol">{symbol.toUpperCase() || ' '}</div>
              </div>
              {!!initialSupply && (
                <Uik.Text className="creator__preview-token-supply" type="headline">
                  {Uik.utils.formatHumanAmount(initialSupply)}
                </Uik.Text>
              )}
            </div>

            <div className={`creator__preview-info ${!burnable ? 'creator__preview-info--disabled' : ''}`}>
              <div className="creator__preview-info-head">
                {burnable
                  ? <CheckCircle2 className="creator-check-icon" />
                  : <XCircle className="creator-check-icon danger" />}
                <p className="creator__preview-info-title">{!burnable && 'Not '}Burnable</p>
              </div>
              <p className="creator__preview-info-description">
                Existing tokens {burnable ? 'can be destroyed to decrease' : 'cannot be destroyed to decrease'} the total supply.
              </p>
            </div>

            <div className={`creator__preview-info ${!mintable ? 'creator__preview-info--disabled' : ''}`}>
              <div className="creator__preview-info-head">
                {mintable
                  ? <CheckCircle2 className="creator-check-icon" />
                  : <XCircle className="creator-check-icon danger" />}
                <p className="creator__preview-info-title">{!mintable && 'Not '}Mintable</p>
              </div>
              <p className="creator__preview-info-description">
                New tokens {mintable ? 'can be created and added to' : 'cannot be created and added to'} the total supply.
              </p>
            </div>

            <Uik.Button
              className="creator__submit"
              disabled={!!validationMsg}
              text="Create Token"
              fill={!validationMsg}
              size="large"
              onClick={() => setConfirmOpen(true)}
            />
          </div>
        </div>
      ) : (
        <div className="creator">
          <div className="creator__creating">
            {!resultMessage.complete && <Uik.Loading />}
            <Uik.Text type="headline">{resultMessage.title}</Uik.Text>
            <Uik.Text>{resultMessage.message}</Uik.Text>
            {resultMessage.contractAddress ? (
              <div className="creator__result-address">
                <span>Contract</span>
                <code>{resultMessage.contractAddress}</code>
              </div>
            ) : null}
            <div className="creator__creating-cta">
              {resultMessage.contractAddress ? (
                <Uik.Button
                  text="View in explorer"
                  size="large"
                  onClick={() => window.open(resultContractUrl || resultTxUrl, '_blank', 'noopener,noreferrer')}
                />
              ) : null}
              {resultMessage.complete && resultMessage.contractAddress ? (
                <Uik.Button
                  text="Create a pool"
                  fill
                  size="large"
                  onClick={() => onCreatePool?.()}
                />
              ) : null}
              {resultMessage.complete ? (
                <Uik.Button
                  text="Create another token"
                  size="large"
                  onClick={resetCreator}
                />
              ) : null}
            </div>
          </div>
        </div>
      )}

      <ConfirmToken
        name={tokenName}
        symbol={symbol}
        supply={initialSupply}
        isBurnable={burnable}
        isMintable={mintable}
        isOpen={isConfirmOpen}
        icon={icon}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleConfirm}
      />
    </>
  );
};

export default CreatorPage;
