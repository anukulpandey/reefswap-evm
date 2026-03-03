import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { initReefState, NETWORK_CONFIGS, NetworkType } from 'reef-evm-util-lib';

type ReefNetwork = typeof NetworkType.ReefMainnet | typeof NetworkType.ReefLocalhost;

type ReefStateContextValue = {
  isReefReady: boolean;
  selectedNetwork: ReefNetwork;
  isSwitchingNetwork: boolean;
  setSelectedNetwork: (network: ReefNetwork) => void;
};

const DEFAULT_NETWORK = NetworkType.ReefLocalhost;
const NETWORK_STORAGE_KEY = 'reef:selected-network';
const NETWORK_CHANGE_SIGNAL_KEY = 'reef:network-change-signal';
const REEF_INIT_TIMEOUT_MS = 8_000;

const getInitialNetwork = (): ReefNetwork => {
  if (typeof window === 'undefined') return DEFAULT_NETWORK;
  const stored = window.localStorage.getItem(NETWORK_STORAGE_KEY);
  if (stored === NetworkType.ReefMainnet || stored === NetworkType.ReefLocalhost) {
    return stored;
  }
  return DEFAULT_NETWORK;
};

const ReefStateContext = createContext<ReefStateContextValue>({
  isReefReady: false,
  selectedNetwork: DEFAULT_NETWORK,
  isSwitchingNetwork: false,
  setSelectedNetwork: () => {},
});

export const ReefStateProvider = ({ children }: { children: React.ReactNode }) => {
  const [isReefReady, setIsReefReady] = useState(false);
  const [isSwitchingNetwork, setIsSwitchingNetwork] = useState(false);
  const [selectedNetwork, setSelectedNetworkState] = useState<ReefNetwork>(getInitialNetwork);

  const setSelectedNetwork = useCallback((network: ReefNetwork) => {
    setSelectedNetworkState((current) => {
      if (current === network) return current;

      if (typeof window !== 'undefined') {
        window.localStorage.setItem(NETWORK_STORAGE_KEY, network);
        window.localStorage.setItem(NETWORK_CHANGE_SIGNAL_KEY, `${Date.now()}:${network}`);
        // Force a full refresh so all screens/hooks reset against the new network.
        window.setTimeout(() => window.location.reload(), 25);
      }

      return network;
    });
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onStorage = (event: StorageEvent) => {
      if (event.key !== NETWORK_CHANGE_SIGNAL_KEY || !event.newValue) return;
      // Reload other open tabs/windows when network changes elsewhere.
      window.location.reload();
    };

    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  useEffect(() => {
    let active = true;
    setIsReefReady(false);
    setIsSwitchingNetwork(true);

    const initPromise = Promise.race([
      initReefState(NETWORK_CONFIGS[selectedNetwork]),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Reef network initialization timed out')), REEF_INIT_TIMEOUT_MS);
      }),
    ]);

    initPromise
      .then(() => {
        if (!active) return;
        setIsReefReady(true);
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(NETWORK_STORAGE_KEY, selectedNetwork);
        }
      })
      .catch((err) => {
        if (!active) return;
        console.error('Failed to initialize reef state:', err);
      })
      .finally(() => {
        if (active) {
          setIsSwitchingNetwork(false);
        }
      });

    return () => {
      active = false;
    };
  }, [selectedNetwork]);

  const value = useMemo(
    () => ({
      isReefReady,
      selectedNetwork,
      isSwitchingNetwork,
      setSelectedNetwork,
    }),
    [isReefReady, selectedNetwork, isSwitchingNetwork, setSelectedNetwork],
  );

  return (
    <ReefStateContext.Provider value={value}>
      {children}
    </ReefStateContext.Provider>
  );
};

export const useReefState = () => useContext(ReefStateContext);
