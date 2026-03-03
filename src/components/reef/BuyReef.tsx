import React from 'react';
import Uik from '@reef-chain/ui-kit';
import './buy-reef-button.css';

type BuyReefButtonProps = {
  onClick?: () => void;
};

const Shape = (): JSX.Element => (
  <svg
    version="1.1"
    id="Layer_1"
    xmlns="http://www.w3.org/2000/svg"
    x="0px"
    y="0px"
    viewBox="0 0 1480 512"
    style={{ enableBackground: 'new 0 0 1480 512' } as React.CSSProperties}
    xmlSpace="preserve"
    className="buy-reef-btn__shape"
  >
    <g>
      <g>
        <path d="M0,0h1480v512H0V0z" />
      </g>
    </g>
  </svg>
);

const BuyReef = ({ onClick }: BuyReefButtonProps) => {
  return (
    <button
      type="button"
      className="buy-reef-btn"
      onClick={onClick}
    >
      <Uik.ReefSign className="buy-reef-btn__icon" />
      <span className="buy-reef-btn__text">Buy Reef</span>
      <Uik.Bubbles />
      <Shape />
    </button>
  );
};

export default BuyReef;
