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
