import Uik from '@reef-chain/ui-kit';
import { ArrowLeftRight } from 'lucide-react';
import './pool-detail.css';

const yAxisLabels = Array.from({ length: 12 }, () => '0.62 REEF');

const PoolDetailPage = (): JSX.Element => (
  <div className="pool-detail-page">
    <section className="pool-detail-hero">
      <div className="pool-detail-hero__inner">
        <div className="pool-detail-hero__left">
          <div className="pool-detail-hero__top-row">
            <div className="pool-detail-pair-pill">
              <span className="pool-detail-pair-pill__icons">
                <span className="pool-icon pool-icon--reef">
                  <Uik.ReefIcon className="pool-icon__reef-mark" />
                </span>
                <span className="pool-icon pool-icon--flpr">F</span>
              </span>
              <span className="pool-detail-pair-pill__text">REEF / FLPR</span>
            </div>

            <button type="button" className="pool-detail-transactions-btn">
              <ArrowLeftRight className="pool-detail-transactions-btn__icon" />
              Show Transactions
            </button>
          </div>

          <div className="pool-detail-hero__stats">
            <div>
              <p className="pool-detail-hero__label">Total Value Locked</p>
              <p className="pool-detail-hero__value">$ 0.49</p>
            </div>
            <div>
              <p className="pool-detail-hero__label">My Liquidity</p>
              <p className="pool-detail-hero__value">$ 0.49</p>
            </div>
            <div>
              <p className="pool-detail-hero__label">24h Volume</p>
              <p className="pool-detail-hero__value">
                $ 0 <span className="pool-detail-hero__positive">▲ 0.00%</span>
              </p>
            </div>
          </div>
        </div>

        <div className="pool-detail-hero__divider" />

        <div className="pool-detail-token-metrics">
          <article className="pool-detail-token-metrics__item">
            <div className="pool-detail-token-metrics__top">
              <div className="pool-detail-token-metrics__token">
                <span className="pool-icon pool-icon--reef pool-icon--large">
                  <Uik.ReefIcon className="pool-icon__reef-mark" />
                </span>
                <div>
                  <p className="pool-detail-token-metrics__symbol">REEF</p>
                  <p className="pool-detail-token-metrics__share">38.37%</p>
                </div>
              </div>
              <div className="pool-detail-token-metrics__price">
                <p>$0.0001</p>
                <span>0.62 FLPR</span>
              </div>
            </div>
            <div className="pool-detail-token-metrics__bottom">
              <div>
                <p>Total Liquidity</p>
                <strong>3.37 k</strong>
              </div>
              <div>
                <p>My Liquidity</p>
                <strong>3.37 k</strong>
              </div>
              <div>
                <p>Fees 24h</p>
                <strong>0</strong>
              </div>
            </div>
          </article>

          <article className="pool-detail-token-metrics__item">
            <div className="pool-detail-token-metrics__top">
              <div className="pool-detail-token-metrics__token">
                <span className="pool-icon pool-icon--flpr pool-icon--large">F</span>
                <div>
                  <p className="pool-detail-token-metrics__symbol">FLPR</p>
                  <p className="pool-detail-token-metrics__share">61.63%</p>
                </div>
              </div>
              <div className="pool-detail-token-metrics__price">
                <p>$0.0000</p>
                <span>1.61 REEF</span>
              </div>
            </div>
            <div className="pool-detail-token-metrics__bottom">
              <div>
                <p>Total Liquidity</p>
                <strong>5.41 k</strong>
              </div>
              <div>
                <p>My Liquidity</p>
                <strong>5.41 k</strong>
              </div>
              <div>
                <p>Fees 24h</p>
                <strong>0</strong>
              </div>
            </div>
          </article>
        </div>
      </div>
    </section>

    <section className="pool-detail-workspace">
      <div className="pool-detail-trade-card">
        <div className="pool-segmented-tabs">
          <button type="button" className="pool-segmented-tabs__item is-active">Trade</button>
          <button type="button" className="pool-segmented-tabs__item">Stake</button>
          <button type="button" className="pool-segmented-tabs__item">Unstake</button>
        </div>

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
            <ArrowLeftRight size={22} />
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
            <span className="pool-icon pool-icon--flpr" />
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

      </div>

      <div className="pool-detail-chart-card">
        <div className="pool-detail-chart__toolbar">
          <div className="pool-detail-chart__tabs">
            <button type="button" className="pool-detail-chart__tab is-active">FLPR/REEF</button>
            <button type="button" className="pool-detail-chart__tab">Liquidity</button>
            <button type="button" className="pool-detail-chart__tab">Volume</button>
            <button type="button" className="pool-detail-chart__tab">Fees</button>
          </div>
          <div className="pool-detail-chart__range">
            <button type="button" className="pool-detail-chart__tab">1h</button>
            <button type="button" className="pool-detail-chart__tab is-active">1D</button>
            <button type="button" className="pool-detail-chart__tab">1W</button>
            <button type="button" className="pool-detail-chart__tab">1M</button>
          </div>
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
      </div>
    </section>
  </div>
);

export default PoolDetailPage;
