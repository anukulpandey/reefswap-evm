import React from 'react';
import Uik from '@reef-chain/ui-kit';
import './confirm-token.css';

export interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConfirm?: () => void;
  name?: string;
  symbol?: string;
  supply?: string;
  icon?: string;
  isBurnable?: boolean;
  isMintable?: boolean;
}

const ConfirmToken = ({
  isOpen,
  onClose,
  onConfirm,
  name,
  symbol,
  supply,
  isBurnable,
  isMintable,
}: Props): JSX.Element => (
  <Uik.Modal
    className="confirm-token"
    title="Confirm your token"
    isOpen={isOpen}
    onClose={onClose}
    footer={(
      <Uik.Button
        text="Create token"
        fill
        size="large"
        onClick={() => {
          if (onConfirm) onConfirm();
          if (onClose) onClose();
        }}
      />
    )}
  >
    <div className="confirm-token-summary">
      {[
        { label: 'Token name', value: name || '—' },
        { label: 'Token symbol', value: (symbol || '').toUpperCase() || '—' },
        { label: 'Initial supply', value: supply ? Uik.utils.formatAmount(supply) : '0' },
        { label: 'Burnable', value: isBurnable ? 'Yes' : 'No' },
        { label: 'Mintable', value: isMintable ? 'Yes' : 'No' },
      ].map((item) => (
        <div key={item.label} className="confirm-token-summary-item">
          <div className="confirm-token-summary-item-label">{item.label}</div>
          <div className="confirm-token-summary-item-value">{item.value}</div>
        </div>
      ))}
    </div>
  </Uik.Modal>
);

export default ConfirmToken;
