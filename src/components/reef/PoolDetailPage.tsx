import { useState } from 'react';
import Uik from '@reef-chain/ui-kit';
import { ArrowLeftRight } from 'lucide-react';
import { faArrowsRotate, faRightLeft } from '@fortawesome/free-solid-svg-icons';
import './pool-detail.css';

type ActionTab = 'trade' | 'stake' | 'unstake';
type ChartTab = 'price' | 'liquidity' | 'volume' | 'fees';
type Timeframe = '1h' | '1D' | '1W' | '1M';

const yAxisLabels = Array.from({ length: 12 }, () => '0.62 REEF');

const poolStatsTokens = [
  {
    symbol: 'REEF',
    percent: '38.37',
    usdPrice: '$0.0001',
    ratio: '0.62 FLPR',
    totalLiquidity: '3.37 k',
    myLiquidity: '3.37 k',
    fees24h: '0',
  },
  {
    symbol: 'FLPR',
    percent: '61.63',
    usdPrice: '$0.0000',
    ratio: '1.61 REEF',
    totalLiquidity: '5.41 k',
    myLiquidity: '5.41 k',
    fees24h: '0',
  },
];

const PoolDetailPage = (): JSX.Element => {
  const [actionTab, setActionTab] = useState<ActionTab>('trade');
  const [chartTab, setChartTab] = useState<ChartTab>('price');
  const [timeframe, setTimeframe] = useState<Timeframe>('1D');

  return (
    <div className="pool">
      <section className="pool-stats">
        <div className="pool-stats__wrapper">
          <div className="pool-stats__main">
            <div className="pool-stats__toolbar">
              <div className="pool-stats__pool-select">
                <div className="pool-stats__pool-select-pair">
                  <span className="pool-stats__pool-select-pair--reef">
                    <Uik.ReefIcon className="pool-stats__pool-select-pair-icon" />
                  </span>
                  <span className="pool-stats__pool-select-pair--flpr">F</span>
                </div>
                <span className="pool-stats__pool-select-name">REEF / FLPR</span>
              </div>

              <Uik.Button
                className="pool-stats__transactions-btn"
                text="Show Transactions"
                size="small"
                icon={faRightLeft}
                onClick={() => {}}
              />
            </div>

            <div className="pool-stats__main-stats">
              <div className="pool-stats__main-stat">
                <div className="pool-stats__main-stat-label">Total Value Locked</div>
                <div className="pool-stats__main-stat-value">$ 0.49</div>
              </div>

              <div className="pool-stats__main-stat">
                <div className="pool-stats__main-stat-label">My Liquidity</div>
                <div className="pool-stats__main-stat-value">$ 0.49</div>
              </div>

              <div className="pool-stats__main-stat">
                <div className="pool-stats__main-stat-label">24h Volume</div>
                <div className="pool-stats__main-stat-value">
                  <span>$ 0</span>
                  <Uik.Trend type="good" direction="up" text="0.00%" />
                </div>
              </div>
            </div>
          </div>

          <div className="pool-stats__tokens">
            {poolStatsTokens.map((token) => (
              <article key={token.symbol} className="pool-stats__token">
                <div className="pool-stats__token-info">
                  <div className="pool-stats__token-main">
                    <span
                      className={`pool-stats__token-image ${token.symbol === 'REEF' ? 'pool-stats__token-image--reef' : 'pool-stats__token-image--flpr'}`}
                    >
                      {token.symbol === 'REEF' ? <Uik.ReefIcon className="pool-stats__token-image-icon" /> : 'F'}
                    </span>
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
                  <p className="pool-token-input__symbol">REEF</p>
                  <p className="pool-token-input__balance">3470.0108 REEF</p>
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
                <span className="pool-icon pool-icon--flpr">F</span>
                <div>
                  <p className="pool-token-input__symbol">FLPR</p>
                  <p className="pool-token-input__balance">42.42 B FLPR</p>
                </div>
              </div>
              <p className="pool-token-input__amount">0.0</p>
            </div>

            <div className="pool-trade-meta">
              <div><span>Rate</span><strong>1 REEF = 1.6061 FLPR</strong></div>
              <div><span>Fee</span><strong>0 $</strong></div>
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
              text="Swap"
              icon={faArrowsRotate}
              fill
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
                  { value: 'price', text: 'FLPR/REEF' },
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
                <span className="pool-detail-chart__price-tag">0.62 REEF</span>
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
