import React, { useState } from 'react';

interface AvatarProps {
  src?: string | null;
  initials: string;
  alt: string;
  size?: 'md' | 'lg';
}

export const Avatar: React.FC<AvatarProps> = ({ src, initials, alt, size = 'md' }) => {
  const [imgError, setImgError] = useState(false);

  const sizeClass = size === 'lg' ? 'w-14 h-14' : 'w-11 h-11';
  const textClass = size === 'lg' ? 'font-headline text-headline-md' : 'font-label text-label-lg';

  if (src && !imgError) {
    return (
      <div className={`${sizeClass} rounded-full overflow-hidden bg-light-surface-container shrink-0`}>
        <img
          src={src}
          alt={alt}
          referrerPolicy="no-referrer"
          onError={() => setImgError(true)}
          className="w-full h-full object-cover"
        />
      </div>
    );
  }

  return (
    <div
      className={`${sizeClass} rounded-full bg-light-secondary-container text-light-on-secondary-container flex items-center justify-center shrink-0`}
    >
      <span className={textClass}>{initials}</span>
    </div>
  );
};
