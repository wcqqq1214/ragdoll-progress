(() => {
  const EXTENSION_CLASS = "dcb-cat-enhanced";
  const LAYER_CLASS = "dcb-cat-progress";
  const SPRITE_URL = chrome.runtime.getURL("assets/cat-sprite.png");

  let activeVideo = null;
  let activeLayer = null;
  let rafId = 0;
  let observer = null;
  let installQueued = false;

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  function createLayer() {
    const layer = document.createElement("div");
    layer.className = LAYER_CLASS;
    layer.setAttribute("aria-hidden", "true");
    layer.style.setProperty("--dcb-cat-sprite", `url("${SPRITE_URL}")`);
    layer.style.setProperty("--dcb-progress", "0");

    layer.innerHTML = `
      <div class="dcb-runner"></div>
    `;

    return layer;
  }

  function updateLayer() {
    if (!activeVideo || !activeLayer || !activeLayer.isConnected) {
      rafId = 0;
      return;
    }

    const duration = activeVideo.duration;
    const ratio = duration && Number.isFinite(duration)
      ? clamp(activeVideo.currentTime / duration, 0, 1)
      : 0;

    activeLayer.style.setProperty("--dcb-progress", ratio.toFixed(5));
    activeLayer.classList.toggle("dcb-paused", activeVideo.paused);
    activeLayer.classList.toggle("dcb-ended", activeVideo.ended);

    rafId = requestAnimationFrame(updateLayer);
  }

  function startLoop() {
    if (!rafId) {
      rafId = requestAnimationFrame(updateLayer);
    }
  }

  function installForPlayer(player) {
    const progressContainer = player.querySelector(".ytp-progress-bar-container");
    const video = player.querySelector("video");

    if (!progressContainer || !video) {
      return false;
    }

    let layer = progressContainer.querySelector(`.${LAYER_CLASS}`);
    if (!layer) {
      layer = createLayer();
      progressContainer.appendChild(layer);
    }

    player.classList.add(EXTENSION_CLASS);
    progressContainer.classList.add("dcb-progress-host");
    activeVideo = video;
    activeLayer = layer;
    startLoop();
    return true;
  }

  function findCurrentPlayer() {
    const fullscreenPlayer = document.querySelector(".html5-video-player.ytp-fullscreen");
    if (fullscreenPlayer) {
      return fullscreenPlayer;
    }

    const moviePlayer = document.querySelector("#movie_player.html5-video-player");
    if (moviePlayer) {
      return moviePlayer;
    }

    return document.querySelector(".html5-video-player");
  }

  function queueInstall() {
    if (installQueued) {
      return;
    }

    installQueued = true;
    window.setTimeout(() => {
      installQueued = false;
      const player = findCurrentPlayer();
      if (player) {
        installForPlayer(player);
      }
    }, 150);
  }

  function observePage() {
    observer = new MutationObserver(queueInstall);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    window.addEventListener("yt-navigate-finish", queueInstall, true);
    window.addEventListener("fullscreenchange", queueInstall, true);
    window.addEventListener("resize", queueInstall, { passive: true });
  }

  queueInstall();
  observePage();
})();
