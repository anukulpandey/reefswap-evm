import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Copy, ExternalLink } from 'lucide-react';
import Uik from '@reef-chain/ui-kit';
import { NetworkType } from 'reef-evm-util-lib';
import { useReefExplorer } from '@/hooks/useReefExplorer';
import { useReefState } from '@/contexts/ReefStateContext';
 
interface AccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLogout?: () => void;
  address?: string;
  walletName?: string;
}

const AccountModal = ({ isOpen, onClose, onLogout, address, walletName }: AccountModalProps) => {
  const { accountExplorerUrl } = useReefExplorer(address);
  const { selectedNetwork, setSelectedNetwork } = useReefState();
  const isDevelopment = selectedNetwork === NetworkType.ReefLocalhost;

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    Uik.notify.success({
      message: `Copied!\n${label} copied to clipboard`,
    });
  };
 
  const truncateAddress = (addr: string, start = 6, end = 4) => {
    if (!addr) return '';
    return `${addr.slice(0, start)}...${addr.slice(-end)}`;
  };
 
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl bg-[#f6f3fb] rounded-3xl border-0 p-0 overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="p-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="rounded-full flex items-center gap-2 border-primary/60 text-primary bg-white/50"
              >
                <div className="w-4 h-4 rounded-full bg-gradient-to-br from-reef-purple to-reef-pink" />
                {walletName || 'Connected Wallet'}
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-sm ${isDevelopment ? 'text-muted-foreground' : 'font-medium text-primary'}`}>Mainnet</span>
              <Switch
                checked={isDevelopment}
                onCheckedChange={(checked) =>
                  setSelectedNetwork(checked ? NetworkType.ReefLocalhost : NetworkType.ReefMainnet)}
              />
              <span className={`text-sm ${isDevelopment ? 'font-medium text-primary' : 'text-muted-foreground'}`}>Development</span>
            </div>
          </div>
        </div>

        {/* Account Card */}
        <div className="px-6 pb-6 pt-0">
          <div className="bg-white/70 rounded-2xl p-6 shadow-sm">
            <div className="flex items-start gap-5">
              {/* Avatar */}
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-reef-purple via-reef-pink to-accent flex-shrink-0" />
 
              {/* Account Info */}
              <div className="flex-1 min-w-0">
                <h4 className="font-semibold text-foreground mb-2">Account</h4>
 
                {/* EVM Address */}
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs text-muted-foreground">EVM:</span>
                  <span className="text-xs font-mono text-foreground">
                    {address ? truncateAddress(address) : ""}
                  </span>
                  <button
                    onClick={() => copyToClipboard(address || '', 'EVM address')}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                </div>
 
                <a
                  href={accountExplorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                >
                  Open in Explorer
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
 
              {/* QR Code placeholder */}
              <div className="w-20 h-20 bg-white rounded-2xl border border-white/70 shadow-sm flex items-center justify-center">
                <Uik.QRCode value={address || ''} className="w-14 h-14" />
              </div>
            </div>

            <Button
              className="w-full mt-6 bg-[#e24b4b] hover:bg-[#cf3f3f] text-white rounded-full py-6 text-base"
              onClick={() => {
                onLogout?.();
                onClose();
              }}
            >
              Logout
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
 
export default AccountModal;
