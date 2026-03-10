import { useMemo, useState } from 'react';
import Uik from '@reef-chain/ui-kit';
import { ArrowLeftRight } from 'lucide-react';
import { faArrowsRotate, faRightLeft } from '@fortawesome/free-solid-svg-icons';
import { type SubgraphPair } from '@/lib/subgraph';
import { useSubgraphPairTransactions } from '@/hooks/useSubgraph';
import { resolveTokenIconUrl } from '@/lib/tokenIcons';
import './pool-detail.css';

type ActionTab = 'trade' | 'stake' | 'unstake';
type ChartTab = 'price' | 'liquidity' | 'volume' | 'fees';
type Timeframe = '1h' | '1D' | '1W' | '1M';

type PoolDetailPageProps = {
  pair: SubgraphPair | null;
};

const asNumber = (value: string | number | null | undefined): number => {
  const parsed = Number.parseFloat(String(value ?? '0'));
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatUsd = (value: string | number | null | undefined): string => (
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(asNumber(value))
);

const formatTokenAmount = (value: string | number | null | undefined): string => (
  new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  }).format(asNumber(value))
);

const formatRate = (value: string | number | null | undefined): string => (
  new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 8,
  }).format(asNumber(value))
);

const PoolDetailPage = ({ pair }: PoolDetailPageProps): JSX.Element => {
  const [actionTab, setActionTab] = useState<ActionTab>('trade');
  const [chartTab, setChartTab] = useState<ChartTab>('price');
  const [timeframe, setTimeframe] = useState<Timeframe>('1D');
  const { data: pairTransactions } = useSubgraphPairTransactions(pair?.id, 20);

  const token0Symbol = pair?.token0.symbol || 'REEF';
  const token1Symbol = pair?.token1.symbol || 'TOKEN';
  const token0Address = pair?.token0.id || null;
  const token1Address = pair?.token1.id || null;
  const token0Icon = resolveTokenIconUrl({ address: token0Address, symbol: token0Symbol, iconUrl: null });
  const token1Icon = resolveTokenIconUrl({ address: token1Address, symbol: token1Symbol, iconUrl: null });
  const reserve0 = asNumber(pair?.reserve0);
  const reserve1 = asNumber(pair?.reserve1);
  const reserveTotal = reserve0 + reserve1;
  const token0Weight = reserveTotal > 0 ? (reserve0 / reserveTotal) * 100 : 0;
  const token1Weight = reserveTotal > 0 ? (reserve1 / reserveTotal) * 100 : 0;

  const yAxisLabels = useMemo(() => {
    const marker = `${formatRate(pair?.token0Price || 0)} ${token1Symbol}`;
    return Array.from({ length: 12 }, () => marker);
  }, [pair?.token0Price, token1Symbol]);

  const poolStatsTokens = [
    {
      symbol: token0Symbol,
      percent: token0Weight.toFixed(2),
      usdPrice: formatUsd(asNumber(pair?.reserveUSD) > 0 ? asNumber(pair?.reserveUSD) / Math.max(reserve0, 1) : 0),
      ratio: `1 ${token0Symbol} = ${formatRate(pair?.token0Price)} ${token1Symbol}`,
      totalLiquidity: formatTokenAmount(reserve0),
      myLiquidity: '-',
      fees24h: '-',
    },
    {
      symbol: token1Symbol,
      percent: token1Weight.toFixed(2),
      usdPrice: formatUsd(asNumber(pair?.reserveUSD) > 0 ? asNumber(pair?.reserveUSD) / Math.max(reserve1, 1) : 0),
      ratio: `1 ${token1Symbol} = ${formatRate(pair?.token1Price)} ${token0Symbol}`,
      totalLiquidity: formatTokenAmount(reserve1),
      myLiquidity: '-',
      fees24h: '-',
    },
  ];

  const totalTransactions = (pairTransactions?.swaps.length || 0) + (pairTransactions?.mints.length || 0) + (pairTransactions?.burns.length || 0);
  const txSummaryText = 'Show Transactions';

  return (
    <div className="pool">
      <section className="pool-stats">
        <div className="pool-stats__wrapper">
          <div className="pool-stats__main">
            <div className="pool-stats__toolbar">
              <div className="pool-stats__pool-select">
                <div className="pool-stats__pool-select-pair">
                  <img
                    src={token0Icon}
                    alt={token0Symbol}
                    className={`pool-stats__pool-select-pair--${Uik.utils.slug(token0Symbol)}`}
                  />
                  <img
                    src={token1Icon}
                    alt={token1Symbol}
                    className={`pool-stats__pool-select-pair--${Uik.utils.slug(token1Symbol)}`}
                  />
                </div>
                <span className="pool-stats__pool-select-name">{token0Symbol} / {token1Symbol}</span>
              </div>

              <Uik.Button
                className="pool-stats__transactions-btn"
                text={txSummaryText}
                size="small"
                icon={faRightLeft}
                onClick={() => {}}
              />
            </div>

            <div className="pool-stats__main-stats">
              <div className="pool-stats__main-stat">
                <div className="pool-stats__main-stat-label">Total Value Locked</div>
                <div className="pool-stats__main-stat-value">{formatUsd(pair?.reserveUSD)}</div>
              </div>

              <div className="pool-stats__main-stat">
                <div className="pool-stats__main-stat-label">My Liquidity</div>
                <div className="pool-stats__main-stat-value">{formatUsd(0)}</div>
              </div>

              <div className="pool-stats__main-stat">
                <div className="pool-stats__main-stat-label">24h Volume</div>
                <div className="pool-stats__main-stat-value">
                  <span>{formatUsd(pair?.volumeUSD)}</span>
                  <Uik.Trend type="good" direction="up" text={`${totalTransactions > 0 ? '+' : ''}${totalTransactions.toFixed(2)}%`} />
                </div>
              </div>
            </div>
          </div>

          <div className="pool-stats__tokens">
            {poolStatsTokens.map((token) => (
              <article key={token.symbol} className="pool-stats__token">
                <div className="pool-stats__token-info">
                  <div className="pool-stats__token-main">
                    <img
                      src={token.symbol === token0Symbol ? token0Icon : token1Icon}
                      alt={token.symbol}
                      className={`pool-stats__token-image pool-stats__token-image--${Uik.utils.slug(token.symbol)}`}
                    />
                    <div>
                      <div className="pool-stats__token-name">{token.symbol}</div>
                      <div className="pool-stats__token-percentage">{token.percent}%</div>
                    </div>
                  </div>

                  <div>
                    <div className="pool-stats__token-price">{token.usdPrice}</div>
                    <div className="pool-stats__token-value-ratio">{token.ratio}</div>
                  </div>
                </div>

                <div className="pool-stats__token-stats">
                  <div className="pool-stats__token-stat">
                    <div className="pool-stats__token-stat-label">Total Liquidity</div>
                    <div className="pool-stats__token-stat-value">{token.totalLiquidity}</div>
                  </div>
                  <div className="pool-stats__token-stat">
                    <div className="pool-stats__token-stat-label">My Liquidity</div>
                    <div className="pool-stats__token-stat-value">{token.myLiquidity}</div>
                  </div>
                  <div className="pool-stats__token-stat">
                    <div className="pool-stats__token-stat-label">Fees 24h</div>
                    <div className="pool-stats__token-stat-value">{token.fees24h}</div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="pool__content">
        <div className="uik-pool-actions pool-actions">
          <div className="uik-pool-actions__top">
            <Uik.Tabs
              value={actionTab}
              onChange={(value) => setActionTab(value as ActionTab)}
              options={[
                { value: 'trade', text: 'Trade' },
                { value: 'stake', text: 'Stake' },
                { value: 'unstake', text: 'Unstake' },
              ]}
            />
          </div>

          <div className="pool-actions__panel">
            <div className="pool-token-input">
              <div className="pool-token-input__left">
                <span className="pool-icon pool-icon--reef">
                  <Uik.ReefIcon className="pool-icon__reef-mark" />
                </span>
                <div>
                  <p className="pool-token-input__symbol">{token0Symbol}</p>
                  <p className="pool-token-input__balance">{formatTokenAmount(reserve0)} {token0Symbol}</p>
                </div>
              </div>
              <p className="pool-token-input__amount">0.0</p>
            </div>

            <div className="pool-slider-block">
              <button type="button" className="pool-slider-switch-btn" aria-label="Switch assets">
                <ArrowLeftRight size={18} />
              </button>
              <div className="pool-slider-track-wrap">
                <span className="pool-slider-badge">0%</span>
                <div className="pool-slider-track">
                  <span className="pool-slider-track__fill" style={{ width: '2%' }} />
                  {[0, 1, 2, 3, 4].map((dot) => (
                    <span key={dot} className={`pool-slider-track__dot ${dot === 0 ? 'is-active' : ''}`} />
                  ))}
                </div>
                <div className="pool-slider-track__labels">
                  <span>0%</span>
                  <span>50%</span>
                  <span>100%</span>
                </div>
              </div>
            </div>

            <div className="pool-token-input">
              <div className="pool-token-input__left">
                <span className="pool-icon pool-icon--flpr">{token1Symbol.slice(0, 1)}</span>
                <div>
                  <p className="pool-token-input__symbol">{token1Symbol}</p>
                  <p className="pool-token-input__balance">{formatTokenAmount(reserve1)} {token1Symbol}</p>
                </div>
              </div>
              <p className="pool-token-input__amount">0.0</p>
            </div>

            <div className="pool-trade-meta">
              <div><span>Rate</span><strong>1 {token0Symbol} = {formatRate(pair?.token0Price)} {token1Symbol}</strong></div>
              <div><span>Fee</span><strong>0.3%</strong></div>
              <div><span>Slippage</span><strong>0.8%</strong></div>
            </div>

            <div className="pool-slider-track-wrap pool-slider-track-wrap--slippage">
              <span className="pool-slider-badge">0.8%</span>
              <div className="pool-slider-track">
                <span className="pool-slider-track__fill" style={{ width: '5%' }} />
                {[0, 1, 2, 3, 4].map((dot) => (
                  <span key={dot} className={`pool-slider-track__dot ${dot === 0 ? 'is-active' : ''}`} />
                ))}
              </div>
            </div>

            <Uik.Button
              className="pool-actions__swap-btn"
              text={`Missing ${token0Symbol} amount`}
              icon={faArrowsRotate}
              disabled
              onClick={() => {}}
            />
          </div>
        </div>

        <div className="pool-chart">
          <Uik.Card>
            <div className="pool-chart__top">
              <Uik.Tabs
                value={chartTab}
                onChange={(value) => setChartTab(value as ChartTab)}
                options={[
                  { value: 'price', text: `${token1Symbol}/${token0Symbol}` },
                  { value: 'liquidity', text: 'Liquidity' },
                  { value: 'volume', text: 'Volume' },
                  { value: 'fees', text: 'Fees' },
                ]}
              />

              <Uik.Tabs
                value={timeframe}
                onChange={(value) => setTimeframe(value as Timeframe)}
                options={[
                  { value: '1h', text: '1h' },
                  { value: '1D', text: '1D' },
                  { value: '1W', text: '1W' },
                  { value: '1M', text: '1M' },
                ]}
              />
            </div>

            <div className="pool-detail-chart__body">
              <div className="pool-detail-chart__plot">
                <div className="pool-detail-chart__grid" />
                <span className="pool-detail-chart__line pool-detail-chart__line--vertical" />
                <span className="pool-detail-chart__line pool-detail-chart__line--horizontal" />
                <span className="pool-detail-chart__price-tag">{formatRate(pair?.token0Price)} {token1Symbol}</span>
              </div>
              <div className="pool-detail-chart__axis">
                {yAxisLabels.map((label, index) => (
                  <span key={`${label}-${index}`}>{label}</span>
                ))}
              </div>
            </div>
          </Uik.Card>
        </div>
      </section>
    </div>
  );
};

export default PoolDetailPage;
