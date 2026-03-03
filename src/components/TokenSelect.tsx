import type { TokenOption } from '../lib/tokens';
import { tokenKey } from '../lib/tokens';

type TokenSelectProps = {
  label: string;
  value: TokenOption;
  options: TokenOption[];
  onChange: (token: TokenOption) => void;
};

const TokenSelect = ({ label, value, options, onChange }: TokenSelectProps) => {
  return (
    <label className="token-select">
      <span>{label}</span>
      <select
        value={tokenKey(value)}
        onChange={(event) => {
          const selected = options.find((token) => tokenKey(token) === event.target.value);
          if (selected) onChange(selected);
        }}
      >
        {options.map((token) => (
          <option key={tokenKey(token)} value={tokenKey(token)}>
            {token.symbol}
          </option>
        ))}
      </select>
    </label>
  );
};

export default TokenSelect;
