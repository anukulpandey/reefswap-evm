import React, { useMemo, useState } from 'react';
import Uik from '@reef-chain/ui-kit';
import { CheckCircle2, XCircle } from 'lucide-react';
import './creator.css';
import IconUpload from './IconUpload';
import ConfirmToken from './ConfirmToken';

const CreatorPage = (): JSX.Element => {
  const [tokenName, setTokenName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [initialSupply, setInitialSupply] = useState('');
  const [burnable, setBurnable] = useState(true);
  const [mintable, setMintable] = useState(true);
  const [icon, setIcon] = useState('');
  const [isConfirmOpen, setConfirmOpen] = useState(false);
  const [status, setStatus] = useState('');

  const validationMsg = useMemo(() => {
    if (!tokenName.trim()) return 'Set token name';
    if (!symbol.trim()) return 'Set token symbol';
    if (!initialSupply.trim()) return 'Set initial supply';
    const n = parseInt(initialSupply, 10);
    if (!Number.isInteger(n) || n <= 0) return 'Initial supply must be a positive whole number';
    return '';
  }, [tokenName, symbol, initialSupply]);

  const handleSupplyInput = (value = '') => {
    setInitialSupply(value.replace(/[^0-9]/g, ''));
  };

  const handleConfirm = () => {
    setStatus('Token draft confirmed. Wire this form to your deploy script to publish on-chain.');
  };

  return (
    <>
      <div className="creator">
        <div className="creator__form">
          <Uik.Container flow="spaceBetween">
            <Uik.Container vertical flow="start">
              <Uik.Text type="headline">Create your token</Uik.Text>
              <Uik.Text type="lead">Use Reef chain to create your own token.</Uik.Text>
            </Uik.Container>
            <IconUpload value={icon} onChange={setIcon} />
          </Uik.Container>

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
          <Uik.Text type="lead" className="creator__preview-title">Token Preview</Uik.Text>

          <div className="creator__preview-token">
            <div className="creator__preview-token-image">
              {icon ? (
                <img src={icon} alt="Token icon" key={icon} />
              ) : null}
            </div>
            <div className="creator__preview-token-info">
              <div className="creator__preview-token-name">{tokenName || ''}</div>
              <div className="creator__preview-token-symbol">{symbol.toUpperCase() || ''}</div>
            </div>
            {!!initialSupply && (
              <Uik.Text className="creator__preview-token-supply" type="headline">
                {Uik.utils.formatHumanAmount(initialSupply)}
              </Uik.Text>
            )}
          </div>

          <div className={`creator__preview-info ${!burnable ? 'creator__preview-info--disabled' : ''}`}>
            <Uik.Container flow="start">
              {burnable
                ? <CheckCircle2 className="creator-check-icon" />
                : <XCircle className="creator-check-icon danger" />}
              <Uik.Text className="creator__preview-info-title">{!burnable && 'Not '}Burnable</Uik.Text>
            </Uik.Container>
            <Uik.Text type="mini">
              Existing tokens {burnable ? 'can be destroyed to decrease' : 'cannot be destroyed to decrease'} the total supply.
            </Uik.Text>
          </div>

          <div className={`creator__preview-info ${!mintable ? 'creator__preview-info--disabled' : ''}`}>
            <Uik.Container flow="start">
              {mintable
                ? <CheckCircle2 className="creator-check-icon" />
                : <XCircle className="creator-check-icon danger" />}
              <Uik.Text className="creator__preview-info-title">{!mintable && 'Not '}Mintable</Uik.Text>
            </Uik.Container>
            <Uik.Text type="mini">
              New tokens {mintable ? 'can be created and added to' : 'cannot be created and added to'} the total supply.
            </Uik.Text>
          </div>

          <Uik.Button
            disabled={!!validationMsg}
            text="Create Token"
            fill={!validationMsg}
            size="large"
            onClick={() => setConfirmOpen(true)}
          />

          {status && (
            <p style={{ marginTop: '12px', fontSize: '0.875rem', color: 'var(--success)', textAlign: 'center' }}>
              {status}
            </p>
          )}
        </div>
      </div>

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
