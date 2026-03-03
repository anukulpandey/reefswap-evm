import React from 'react';
import { ImageIcon } from 'lucide-react';
import './icon-upload.css';

export interface Props {
  value?: string;
  onChange?: (value: string) => void;
}

const toBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
  });

const IconUpload = ({ value, onChange }: Props): JSX.Element => {
  const processFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const res = await toBase64(file).catch(() => '');
    if (res && onChange) onChange(res);
  };

  return (
    <div className="icon-upload">
      {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
      <label className="icon-upload__area" htmlFor="token-icon-upload">
        {value ? (
          <img className="icon-upload__image" src={value} alt="Token icon" key={value} />
        ) : (
          <ImageIcon className="icon-upload__icon" />
        )}
      </label>
      <input
        id="token-icon-upload"
        accept="image/*"
        type="file"
        onChange={processFile}
      />
    </div>
  );
};

export default IconUpload;
