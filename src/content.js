(() => {
  const EXTENSION_CLASS = "dcb-cat-enhanced";
  const LAYER_CLASS = "dcb-cat-progress";
  const SPRITE_URL = chrome.runtime.getURL("assets/cat-sprite.png");
  const SITE_CLASS_PREFIX = "dcb-site-";

  const SITE_CONFIGS = [
    {
      id: "youtube",
      hostnames: ["youtube.com"],
      playerSelectors: [
        ".html5-video-player.ytp-fullscreen",
        "#movie_player.html5-video-player",
        ".html5-video-player"
      ],
      progressSelectors: [
        ".ytp-progress-bar-container"
      ],
      videoSelectors: [
        "video"
      ]
    },
    {
      id: "bilibili",
      hostnames: ["bilibili.com"],
      playerSelectors: [
        ".bpx-player-container[data-screen='full']",
        ".bpx-player-container[data-screen='web']",
        ".bpx-player-container",
        "#bilibili-player",
        ".bilibili-player"
      ],
      progressSelectors: [
        ".bpx-player-progress-area",
        ".bpx-player-progress-wrap",
        ".bpx-player-progress",
        ".bilibili-player-video-progress"
      ],
      videoSelectors: [
        "video"
      ]
    },
    {
      id: "douyin",
      hostnames: ["douyin.com"],
      playerSelectors: [
        ".xgplayer",
        ".xgplayer-pc",
        ".douyin-player",
        "[data-e2e='feed-active-video']",
        "[data-e2e='video-player']"
      ],
      progressSelectors: [
        ".xgplayer-progress",
        ".xgplayer-progress-outer",
        ".xgplayer-progress-inner",
        ".xg-progress",
        ".xg-progress-outer",
        ".xg-progress-inner",
        ".xg-mini-progress",
        "[data-e2e='video-progress']"
      ],
      videoSelectors: [
        "video"
      ]
    }
  ];

  let activeVideo = null;
  let activeLayer = null;
  let rafId = 0;
  let observer = null;
  let installQueued = false;

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  function getCurrentSite() {
    const hostname = window.location.hostname;

    return SITE_CONFIGS.find((site) => (
      site.hostnames.some((host) => hostname === host || hostname.endsWith(`.${host}`))
    ));
  }

  function findFirst(root, selectors) {
    for (const selector of selectors) {
      const match = root.querySelector(selector);
      if (match) {
        return match;
      }
    }

    return null;
  }

  function isVisible(element) {
    const rect = element.getBoundingClientRect();

    return rect.width > 0
      && rect.height > 0
      && rect.bottom > 0
      && rect.right > 0
      && rect.top < window.innerHeight
      && rect.left < window.innerWidth;
  }

  function scoreTarget(target) {
    let score = 0;

    if (!target.video.paused && !target.video.ended) {
      score += 100;
    }

    if (isVisible(target.player)) {
      score += 50;
    }

    if (target.video.duration && Number.isFinite(target.video.duration)) {
      score += 10;
    }

    return score;
  }

  function pickBestTarget(targets) {
    if (!targets.length) {
      return null;
    }

    return targets.reduce((best, target) => (
      scoreTarget(target) > scoreTarget(best) ? target : best
    ));
  }

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

  function prepareProgressHost(progressContainer) {
    progressContainer.classList.add("dcb-progress-host");

    if (window.getComputedStyle(progressContainer).position === "static") {
      progressContainer.style.position = "relative";
    }
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

  function installForTarget(target) {
    if (!target) {
      return false;
    }

    const { site, player, progressContainer, video } = target;
    let layer = progressContainer.querySelector(`.${LAYER_CLASS}`);
    if (!layer) {
      layer = createLayer();
      progressContainer.appendChild(layer);
    }

    layer.dataset.site = site.id;
    player.classList.add(EXTENSION_CLASS, `${SITE_CLASS_PREFIX}${site.id}`);
    prepareProgressHost(progressContainer);

    activeVideo = video;
    activeLayer = layer;
    startLoop();
    return true;
  }

  function findTargetInPlayer(site, player) {
    const progressContainer = findFirst(player, site.progressSelectors);
    const video = findFirst(player, site.videoSelectors);

    if (!progressContainer || !video) {
      return null;
    }

    return {
      site,
      player,
      progressContainer,
      video
    };
  }

  function findFallbackTarget(site) {
    const progressContainer = findFirst(document, site.progressSelectors);
    if (!progressContainer) {
      return null;
    }

    const player = progressContainer.closest(site.playerSelectors.join(","));
    if (!player) {
      return null;
    }

    const video = findFirst(player, site.videoSelectors) || findFirst(document, site.videoSelectors);
    if (!video) {
      return null;
    }

    return {
      site,
      player,
      progressContainer,
      video
    };
  }

  function findCurrentTarget() {
    const site = getCurrentSite();
    if (!site) {
      return null;
    }

    const targets = [];

    for (const selector of site.playerSelectors) {
      for (const player of document.querySelectorAll(selector)) {
        const target = findTargetInPlayer(site, player);
        if (target) {
          targets.push(target);
        }
      }
    }

    const fallbackTarget = findFallbackTarget(site);
    if (fallbackTarget) {
      targets.push(fallbackTarget);
    }

    return pickBestTarget(targets);
  }

  function queueInstall() {
    if (installQueued) {
      return;
    }

    installQueued = true;
    window.setTimeout(() => {
      installQueued = false;
      installForTarget(findCurrentTarget());
    }, 150);
  }

  function observePage() {
    observer = new MutationObserver(queueInstall);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    window.addEventListener("yt-navigate-finish", queueInstall, true);
    window.addEventListener("popstate", queueInstall, true);
    window.addEventListener("pageshow", queueInstall, true);
    window.addEventListener("fullscreenchange", queueInstall, true);
    window.addEventListener("resize", queueInstall, { passive: true });
  }

  queueInstall();
  observePage();
})();
