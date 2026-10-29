/**
 * SmartFace Attendance System - Dynamic SVG Visualizations & Charting
 */

const ChartRenderer = {
  renderCircularGauge(containerId, percentage, label = "Attendance Rate") {
    const container = document.getElementById(containerId);
    if (!container) return;

    const radius = 45;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference - (percentage / 100) * circumference;

    const color = percentage >= 75 ? "#10b981" : percentage >= 50 ? "#f59e0b" : "#ef4444";

    container.innerHTML = `
      <div style="position: relative; width: 120px; height: 120px; margin: 0 auto;">
        <svg viewBox="0 0 100 100" style="transform: rotate(-90deg); width: 100%; height: 100%;">
          <circle cx="50" cy="50" r="${radius}" fill="transparent" stroke="rgba(255,255,255,0.08)" stroke-width="8"></circle>
          <circle cx="50" cy="50" r="${radius}" fill="transparent" stroke="${color}" stroke-width="8"
                  stroke-dasharray="${circumference}" stroke-dashoffset="${strokeDashoffset}"
                  stroke-linecap="round" style="transition: stroke-dashoffset 0.8s ease;"></circle>
        </svg>
        <div style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center;">
          <span style="font-size: 1.4rem; font-weight: 700; color: #fff;">${percentage}%</span>
          <span style="font-size: 0.65rem; color: #94a3b8; text-transform: uppercase;">${label}</span>
        </div>
      </div>
    `;
  },

  renderProgressBar(percentage) {
    const color = percentage >= 75 ? "#10b981" : percentage >= 50 ? "#f59e0b" : "#ef4444";
    return `
      <div style="display: flex; align-items: center; gap: 8px;">
        <div style="flex: 1; height: 6px; background: rgba(255,255,255,0.08); border-radius: 99px; overflow: hidden;">
          <div style="width: ${percentage}%; height: 100%; background: ${color}; border-radius: 99px;"></div>
        </div>
        <span style="font-size: 0.8rem; font-weight: 600; min-width: 40px; text-align: right;">${percentage}%</span>
      </div>
    `;
  }
};

window.ChartRenderer = ChartRenderer;
