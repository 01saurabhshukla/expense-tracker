import { createContext, useCallback, useContext, useEffect, useState } from 'react';

// A short message at the bottom of the screen ("Updated 5 transactions").
const ToastContext = createContext(() => {});

export function ToastProvider({ children }) {
  const [message, setMessage] = useState(null);
  const show = useCallback((text) => setMessage({ text, at: Date.now() }), []);

  useEffect(() => {
    if (!message) return undefined;
    const timer = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [message]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite">{message && <div className="toast">{message.text}</div>}</div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
