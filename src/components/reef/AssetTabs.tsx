 import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
 import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Sparkles } from 'lucide-react';
 import TokenList from './TokenList';
import SqwidButton from './SqwidBtn';
 
interface AssetTabsProps {
  onSwap?: () => void;
}

const AssetTabs = ({ onSwap }: AssetTabsProps) => {
  return (
    <Tabs defaultValue="tokens" className="w-full pl-6">
      <TabsList className="bg-transparent border-b border-border rounded-none w-full justify-start gap-4 h-auto p-0 mb-4">
        <TabsTrigger
          value="tokens"
          className="text-base font-semibold rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-0 pb-3"
        >
          Tokens
        </TabsTrigger>
        <TabsTrigger
          value="nfts"
          className="text-base font-semibold rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-0 pb-3"
        >
          NFTs
        </TabsTrigger>
      </TabsList>

      <TabsContent value="tokens">
        <TokenList onSwap={onSwap} />
      </TabsContent>
 
      <TabsContent value="nfts" className="pt-6">
        <div className="flex flex-col items-center justify-center gap-6 py-14 text-center">
          <p className="text-lg font-semibold text-[#8f8a9b]">
            Your wallet doesn't own any NFTs.
          </p>
          <SqwidButton />
        </div>
      </TabsContent>
     </Tabs>
   );
 };
 
 export default AssetTabs;
