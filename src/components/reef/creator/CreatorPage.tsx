import React, { useMemo, useState } from 'react';
import Uik from '@reef-chain/ui-kit';
import { CheckCircle2, XCircle } from 'lucide-react';
import { BigNumber, ContractFactory, providers } from 'ethers';
import { useAccount } from 'wagmi';
import { getAddress, parseUnits, type Address } from 'viem';
import './creator.css';
import IconUpload from './IconUpload';
import ConfirmToken from './ConfirmToken';
import { reefChain } from '../../../lib/config';
import type { TokenOption } from '../../../lib/tokens';
import { getErrorMessage, shortAddress } from '../../../lib/utils';
import { deployTokens, type DeployContractData } from './tokensDeployData';
import { polkaVmSimpleTokenDeployData } from './polkaVmSimpleTokenDeployData';

type CreatorPageProps = {
  onTokenCreated?: (token: TokenOption) => void;
  onCreatePool?: () => void;
};

type ResultMessage = {
  complete: boolean;
  title: string;
  message: string;
  contractAddress?: Address;
  txHash?: string;
};

const selectDeployData = (burnable: boolean, mintable: boolean): DeployContractData => {
  if (!burnable && !mintable) return deployTokens.noMintNoBurn;
  if (burnable && !mintable) return deployTokens.noMintBurn;
  if (!burnable && mintable) return deployTokens.mintNoBurn;
  return deployTokens.mintBurn;
};

const isCodeRejectedError = (message: string): boolean => {
  const normalized = message.toLowerCase();
  return normalized.includes('coderejected') || normalized.includes('failed to instantiate contract');
};

const CreatorPage = ({ onTokenCreated, onCreatePool }: CreatorPageProps): JSX.Element => {
  const { address, chainId } = useAccount();

  const [tokenName, setTokenName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [initialSupply, setInitialSupply] = useState('');
  const [burnable, setBurnable] = useState(true);
  const [mintable, setMintable] = useState(true);
  const [icon, setIcon] = useState('');
  const [isConfirmOpen, setConfirmOpen] = useState(false);
  const [resultMessage, setResultMessage] = useState<ResultMessage | null>(null);
  const [isCreating, setIsCreating] = useState(false);

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
    if (validationMsg || isCreating) return;
    if (!address) {
      Uik.notify.danger({ message: 'Wallet is not connected.' });
      return;
    }
    if (chainId !== reefChain.id) {
      Uik.notify.danger({ message: `Switch wallet to Reef chain (${reefChain.id}) before creating token.` });
      return;
    }

    const safeName = tokenName.trim();
    const safeSymbol = symbol.trim().toUpperCase();
    const deployData = selectDeployData(burnable, mintable);
    setIsCreating(true);
    setConfirmOpen(false);

    setResultMessage({
      complete: false,
      title: 'Deploying token',
      message: 'Sending token contract transaction for signing.',
    });

    try {
      const deployArgs = [safeName, safeSymbol, parseUnits(initialSupply, 18)] as const;
      const defaultDeployBytecode = `0x${deployData.bytecode.object}`;
      const ethereumProvider = (window as Window & { ethereum?: providers.ExternalProvider }).ethereum;
      if (!ethereumProvider) {
        throw new Error('MetaMask extension not found in browser.');
      }

      // Match reef-app flow: use ethers ContractFactory with injected signer.
      const provider = new providers.Web3Provider(ethereumProvider);
      await provider.send('eth_requestAccounts', []);
      const signer = provider.getSigner(address);
      const signerAddress = getAddress(await signer.getAddress());

      if (signerAddress.toLowerCase() !== address.toLowerCase()) {
        throw new Error(`Connected wallet mismatch. Expected ${address}, got ${signerAddress}.`);
      }

      const submitDeploy = async (factory: ContractFactory) => {
        try {
          return await factory.deploy(...deployArgs);
        } catch (error) {
          const normalizedMessage = getErrorMessage(error).toLowerCase();
          const shouldRetryWithOverrides = (
            normalizedMessage.includes('temporarily banned') ||
            normalizedMessage.includes('invalid transaction') ||
            normalizedMessage.includes('could not estimate gas')
          );
          if (!shouldRetryWithOverrides) throw error;

          const deployTxRequest = factory.getDeployTransaction(...deployArgs);
          let gasLimit = BigNumber.from(4_000_000);
          try {
            const estimatedGas = await signer.estimateGas(deployTxRequest);
            gasLimit = estimatedGas.mul(12).div(10);
          } catch {
            gasLimit = BigNumber.from(4_000_000);
          }

          let fallbackGasPrice = BigNumber.from(1_000_000_000);
          try {
            const rpcGasPrice = await provider.getGasPrice();
            if (rpcGasPrice.gt(0)) fallbackGasPrice = rpcGasPrice;
          } catch {
            fallbackGasPrice = BigNumber.from(1_000_000_000);
          }
          const nonce = await provider.getTransactionCount(signerAddress, 'pending');

          return factory.deploy(...deployArgs, {
            gasLimit,
            gasPrice: fallbackGasPrice,
            nonce,
          });
        }
      };

      const defaultFactory = new ContractFactory(
        deployData.metadata.output.abi,
        defaultDeployBytecode,
        signer,
      );

      let fallbackDeployUsed = false;
      let contract;
      try {
        contract = await submitDeploy(defaultFactory);
      } catch (error) {
        const message = getErrorMessage(error);
        if (!isCodeRejectedError(message)) {
          throw error;
        }

        fallbackDeployUsed = true;
        setResultMessage({
          complete: false,
          title: 'Deploying token',
          message: 'Local node rejected standard bytecode. Retrying with PolkaVM-compatible token bytecode.',
        });

        const fallbackFactory = new ContractFactory(
          polkaVmSimpleTokenDeployData.abi,
          polkaVmSimpleTokenDeployData.bytecode,
          signer,
        );
        contract = await submitDeploy(fallbackFactory);
      }

      const deploymentTx = (contract as any).deploymentTransaction?.() ?? (contract as any).deployTransaction;
      if (!deploymentTx?.hash) {
        throw new Error('Token deployment transaction hash not found.');
      }
      const hash = deploymentTx.hash;

      setResultMessage({
        complete: false,
        title: 'Deploying token',
        message: `Transaction submitted (${shortAddress(hash)}). Waiting for confirmation.`,
        txHash: hash,
      });

      const receipt = await deploymentTx.wait();
      const createdAddress = receipt?.contractAddress ? getAddress(receipt.contractAddress) : null;
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
        message: `Success, ${safeName} (${safeSymbol}) deployed with initial supply ${initialSupply}.${fallbackDeployUsed ? ' Mint/burn toggles are unavailable on this local node bytecode.' : ''}`,
        contractAddress: createdAddress,
        txHash: hash,
      });
      Uik.notify.success({ message: `Token created at ${shortAddress(createdAddress)}` });
    } catch (error) {
      const message = getErrorMessage(error);
      const helpSuffix = message.toLowerCase().includes('temporarily banned')
        ? ' Wait 10-15 seconds and retry.'
        : '';
      setResultMessage({
        complete: true,
        title: 'Error creating token',
        message: `${message}${helpSuffix}`,
      });
      Uik.notify.danger({ message: `${message}${helpSuffix}` });
    } finally {
      setIsCreating(false);
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
              disabled={!!validationMsg || isCreating}
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
        onClose={() => {
          if (!isCreating) setConfirmOpen(false);
        }}
        onConfirm={handleConfirm}
        isSubmitting={isCreating}
      />
    </>
  );
};

export default CreatorPage;
