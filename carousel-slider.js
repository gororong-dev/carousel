class CarouselSlider {
  constructor(container, configManager) {
    this.container = container;
    this.configManager = configManager;
    this.currentIndex = 0;
    this.realIndex = 0; // 무한 스크롤에서 실제 위치 추적
    this.isPlaying = false;
    this.intervalId = null;
    this.images = [];
    this.preloadedImages = new Map();
    this.isTransitioning = false;

    this.touchStartX = 0;
    this.touchEndX = 0;

    this.init();
  }

  init() {
    this.createHTML();
    this.setupEventListeners();
    this.loadImages();
    this.startAutoPlay();
  }

  createHTML() {
    this.container.innerHTML = `
            <div class="carousel-wrapper">
                <div class="carousel-container">
                    <div class="carousel-slides"></div>
                    <div class="carousel-controls">
                        <button class="carousel-btn carousel-prev" title="이전 이미지 (←)">‹</button>
                        <button class="carousel-btn carousel-play-pause" title="재생/일시정지 (스페이스)">⏸️</button>
                        <button class="carousel-btn carousel-next" title="다음 이미지 (→)">›</button>
                    </div>
                    <div class="carousel-indicators"></div>
                </div>
                <div class="carousel-status">
                    <span class="status-text">로딩 중...</span>
                    <div class="status-progress">
                        <div class="progress-bar"></div>
                    </div>
                </div>
            </div>
        `;

    this.slidesContainer = this.container.querySelector(".carousel-slides");
    this.indicators = this.container.querySelector(".carousel-indicators");
    this.prevBtn = this.container.querySelector(".carousel-prev");
    this.nextBtn = this.container.querySelector(".carousel-next");
    this.playPauseBtn = this.container.querySelector(".carousel-play-pause");
    this.statusText = this.container.querySelector(".status-text");
    this.progressBar = this.container.querySelector(".progress-bar");
    this.controls = this.container.querySelector(".carousel-controls");
    this.indicatorsContainer = this.container.querySelector(
      ".carousel-indicators"
    );

    this.applyStyles();
    this.updateControlsVisibility();
  }

  applyStyles() {
    const settings = this.configManager.getSettings();
    // console.log("🎨 스타일 적용:", settings.animationType);

    // 컨테이너 스타일 적용 (동적 값만 JS에서 적용)
    this.container.style.width = settings.containerWidth;
    this.container.style.height = settings.containerHeight;
    this.container.style.backgroundColor = settings.backgroundColor;

    // 무한 스크롤 모드에서 크기 고정 강화
    if (settings.animationType === "scroll") {
      this.container.style.minWidth = settings.containerWidth;
      this.container.style.maxWidth = settings.containerWidth;
      this.container.style.minHeight = settings.containerHeight;
      this.container.style.maxHeight = settings.containerHeight;
      this.container.style.flexShrink = "0";
      this.container.style.overflow = "hidden";

      // console.log("🔒 무한 스크롤 모드: 컨테이너 크기 고정 적용");
    } else {
      // 페이드 모드에서는 고정 제거
      this.container.style.minWidth = "";
      this.container.style.maxWidth = "";
      this.container.style.minHeight = "";
      this.container.style.maxHeight = "";
      this.container.style.flexShrink = "";
    }

    // console.log(
    //   `📏 컨테이너 크기 설정: ${settings.containerWidth} × ${settings.containerHeight}`
    // );
    // console.log(
    //   `📐 실제 컨테이너 크기: ${this.container.offsetWidth}px × ${this.container.offsetHeight}px`
    // );

    // 애니메이션 타입 적용
    const carouselContainer = this.container.querySelector(
      ".carousel-container"
    );
    if (settings.animationType === "scroll") {
      carouselContainer.classList.add("scroll-mode");
      // console.log("✅ 스크롤 모드 CSS 클래스 추가");
    } else {
      carouselContainer.classList.remove("scroll-mode");
      // console.log("✅ 페이드 모드로 변경");
    }

    // 전환 시간 동적 적용
    const slides = this.container.querySelectorAll(".carousel-slide");
    slides.forEach((slide) => {
      slide.style.transition = `opacity ${settings.transitionDuration}ms ease-in-out, transform ${settings.transitionDuration}ms ease-in-out`;
    });

    // 슬라이드 컨테이너 전환 시간 설정
    if (this.slidesContainer) {
      this.slidesContainer.style.transition = `transform ${settings.transitionDuration}ms ease-in-out`;
    }

    // 이미지 스타일 적용
    const images = this.container.querySelectorAll(".carousel-slide img");
    images.forEach((img, index) => {
      img.style.objectFit = settings.imageResize;
      img.style.objectPosition = settings.objectPosition || "center";
      img.style.width = "100%";
      img.style.height = "100%";
      // console.log(`🖼️ 이미지 ${index} 스타일 적용`);
    });

    // 나머지 스타일은 carousel-slider.css에서 관리
  }

  setupEventListeners() {
    // 핸들러 함수들을 this에 바인딩하여 나중에 제거할 수 있도록 저장
    this.keyboardHandler = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")
        return;

      switch (e.code) {
        case "ArrowLeft":
          e.preventDefault();
          // 2장일 때는 이전 슬라이드 비활성화 (오른쪽으로만 무한 스크롤)
          if (this.images.length !== 2) {
            this.previousSlide();
          }
          break;
        case "ArrowRight":
          e.preventDefault();
          this.nextSlide();
          break;
        case "Space":
          e.preventDefault();
          this.togglePlayPause();
          break;
      }
    };

    this.focusHandler = () => {
      if (this.isPlaying) this.startAutoPlay();
    };

    this.prevClickHandler = () => this.previousSlide();
    this.nextClickHandler = () => this.nextSlide();
    this.playPauseClickHandler = () => this.togglePlayPause();

    this.touchStartHandler = (e) => {
      this.touchStartX = e.touches[0].clientX;
    };

    this.touchEndHandler = (e) => {
      this.touchEndX = e.changedTouches[0].clientX;
      this.handleSwipe();
    };

    this.clickHandler = (e) => {
      if (e.target.tagName === "IMG") {
        this.nextSlide();
      }
    };

    this.configChangeHandler = () => {
      this.updateFromConfig();
    };

    // 버튼 이벤트
    this.prevBtn.addEventListener("click", this.prevClickHandler);
    this.nextBtn.addEventListener("click", this.nextClickHandler);
    this.playPauseBtn.addEventListener("click", this.playPauseClickHandler);

    // 키보드 이벤트
    document.addEventListener("keydown", this.keyboardHandler);

    // 터치 이벤트
    this.slidesContainer.addEventListener(
      "touchstart",
      this.touchStartHandler,
      { passive: true }
    );
    this.slidesContainer.addEventListener("touchend", this.touchEndHandler, {
      passive: true,
    });

    // 마우스 이벤트 (클릭으로 다음 슬라이드)
    this.slidesContainer.addEventListener("click", this.clickHandler);

    // 설정 변경 감지
    this.configManager.addEventListener(
      "configChanged",
      this.configChangeHandler
    );

    // 윈도우 포커스 이벤트
    // 오토 슬라이드가 포커스 아웃에도 계속 동작하도록 blur 이벤트에서 pauseAutoPlay 제거
    window.addEventListener("focus", this.focusHandler);
    // window.addEventListener("blur", () => {
    //   this.pauseAutoPlay();
    // });
  }

  handleSwipe() {
    const swipeThreshold = 50;
    const diff = this.touchStartX - this.touchEndX;

    if (Math.abs(diff) > swipeThreshold) {
      if (diff > 0) {
        this.nextSlide(); // 왼쪽으로 스와이프 = 다음
      } else {
        this.previousSlide(); // 오른쪽으로 스와이프 = 이전
      }
    }
  }

  async loadImages() {
    this.updateStatus("이미지 로딩 중...", 0);

    const imageData = this.configManager.getActiveImages();
    if (imageData.length === 0) {
      this.showEmptyState();
      return;
    }

    this.images = imageData.sort((a, b) => a.order - b.order);

    // 슬라이드 요소 생성
    this.createSlideElements();

    // 이미지 프리로딩
    try {
      await this.preloadImages();

      // UI 업데이트 - 순서 중요!
      this.createIndicators();
      this.initializeSlides();

      // 스크롤 모드에서 초기 상태 설정
      const settings = this.configManager.getSettings();
      if (settings.animationType === "scroll" && this.images.length > 1) {
        // 약간의 지연을 두고 초기 위치 재설정
        setTimeout(() => {
          this.ensureProperInitialPosition();
        }, 50);
      }

      // console.log("✅ 이미지 로딩 완료");
    } catch (error) {
      console.error("❌ 이미지 로딩 중 오류:", error);
    } finally {
      // 성공하든 실패하든 상태 메시지 숨김
      this.hideStatus();
    }
  }

  ensureProperInitialPosition() {
    const settings = this.configManager.getSettings();
    if (settings.animationType !== "scroll") return;

    const slideWidth = this.container.offsetWidth;
    const initialOffset = -slideWidth; // 복제본 1개 건너뛰기

    this.slidesContainer.style.transition = "none";
    this.slidesContainer.style.transform = `translateX(${initialOffset}px)`;
    this.realIndex = 1;

    // 트랜지션 재활성화
    requestAnimationFrame(() => {
      this.slidesContainer.style.transition = `transform ${settings.transitionDuration}ms ease-in-out`;
    });

    // console.log("🔧 초기 위치 재설정:", {
    //   realIndex: this.realIndex,
    //   offset: initialOffset,
    // });
  }

  showEmptyState() {
    this.updateStatus("", 100);
    this.slidesContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-message">
          <h2>🖼️ 이미지가 없습니다</h2>
          <p>관리 도구에서 이미지를 추가해보세요!</p>
          <button onclick="window.open('슬라이드관리도구.html', '_blank')" class="btn-primary">
            관리 도구 열기
          </button>
        </div>
      </div>
    `;
    // 빈 상태에서는 상태 메시지 완전히 숨김
    setTimeout(() => {
      this.hideStatus();
    }, 100);
  }

  createSlideElements() {
    this.slidesContainer.innerHTML = "";

    this.images.forEach((imageData, index) => {
      const slide = document.createElement("div");
      slide.className = "carousel-slide";
      slide.setAttribute("data-index", index);

      const img = document.createElement("img");
      img.alt = imageData.alt || imageData.filename;
      img.setAttribute("data-src", imageData.path);

      slide.appendChild(img);
      this.slidesContainer.appendChild(slide);
    });
  }

  async preloadImages() {
    const totalImages = this.images.length;
    let loadedCount = 0;

    // console.log(`🖼️ 총 ${totalImages}개 이미지 프리로딩 시작...`);

    const loadPromises = this.images.map(async (imageData, index) => {
      return new Promise(async (resolve) => {
        const img = new Image();

        const updateProgress = () => {
          loadedCount++;
          const progress = (loadedCount / totalImages) * 100;
          this.updateStatus(
            `이미지 로딩 중... (${loadedCount}/${totalImages})`,
            progress
          );
          // console.log(
          //   `📈 이미지 로딩 진행률: ${Math.round(
          //     progress
          //   )}% (${loadedCount}/${totalImages})`
          // );
        };

        img.onload = () => {
          this.preloadedImages.set(imageData.path, img);
          updateProgress();
          // console.log(`✅ 이미지 로딩 성공: ${imageData.filename}`);
          resolve();
        };

        img.onerror = () => {
          // console.error(
          //   `❌ 이미지 로딩 실패: ${imageData.filename} (${imageData.path})`
          // );
          updateProgress();
          resolve(); // 실패해도 계속 진행
        };

        // ConfigManager를 통해 실제 이미지 데이터 획득
        try {
          const actualImageSrc = await this.configManager.getImageData(
            imageData.path
          );
          console.log(
            `✅ 이미지 경로 처리: ${imageData.path} -> ${actualImageSrc}`
          );
          img.src = actualImageSrc;
        } catch (error) {
          console.error("❌ 이미지 데이터 획득 실패:", error);
          img.src = imageData.path; // 폴백
        }
      });
    });

    await Promise.all(loadPromises);
    // console.log(`🎉 모든 이미지 프리로딩 완료 (${loadedCount}/${totalImages})`);

    // 실제 이미지 요소에 적용
    this.applyPreloadedImages();
  }

  applyPreloadedImages() {
    const slides = this.slidesContainer.querySelectorAll(".carousel-slide");
    const settings = this.configManager.getSettings();

    // console.log("🖼️ 이미지 적용 시작:", {
    //   slideCount: slides.length,
    //   imageCount: this.images.length,
    //   animationType: settings.animationType,
    // });

    slides.forEach((slide, index) => {
      const img = slide.querySelector("img");
      const imageData = this.images[index];

      if (!imageData) {
        // console.warn(`⚠️ 인덱스 ${index}에 이미지 데이터 없음`);
        return;
      }

      const preloadedImg = this.preloadedImages.get(imageData.path);

      if (preloadedImg) {
        img.src = preloadedImg.src;
        // console.log(`✅ 이미지 ${index} 적용 성공:`, imageData.filename);
      } else {
        // 프리로딩 실패 시 기본 이미지 또는 오류 표시
        img.src =
          "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgZmlsbD0iI2Y1ZjVmNSIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LXNpemU9IjE0IiBmaWxsPSIjOTk5IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSI+이미지 로드 실패</dGV4dD48L3N2Zz4=";
        console.error(`❌ 이미지 ${index} 프리로딩 실패:`, imageData.filename);
      }

      // 이미지 스타일 적용
      img.style.objectFit = settings.imageResize;
      img.style.objectPosition = settings.objectPosition || "center";

      // 스크롤 모드에서 이미지가 보이도록 강제 설정
      if (settings.animationType === "scroll") {
        slide.style.display = "block";
        slide.style.opacity = "1";
        img.style.display = "block";

        // 디버깅: 슬라이드 위치와 크기 정보 로그
        const slideRect = slide.getBoundingClientRect();
        const containerRect = this.container.getBoundingClientRect();
        // console.log(`🔍 슬라이드 ${index} 렌더링 정보:`, {
        //   width: slide.offsetWidth,
        //   height: slide.offsetHeight,
        //   left: slideRect.left - containerRect.left,
        //   visible:
        //     slideRect.right > containerRect.left &&
        //     slideRect.left < containerRect.right,
        // });
      }
    });
  }

  createIndicators() {
    if (!this.configManager.getSettings().showIndicators) {
      this.indicators.classList.add("hidden");
      return;
    }

    this.indicators.classList.remove("hidden");
    this.indicators.innerHTML = "";

    this.images.forEach((_, index) => {
      const indicator = document.createElement("div");
      indicator.className = "carousel-indicator";
      indicator.title = `이미지 ${index + 1}`;
      indicator.addEventListener("click", () => this.goToSlide(index));
      this.indicators.appendChild(indicator);
    });
  }

  setupInfiniteScroll() {
    const settings = this.configManager.getSettings();
    if (settings.animationType !== "scroll" || this.images.length < 2) {
      return;
    }

    // 기존 슬라이드들 가져오기
    const originalSlides = Array.from(
      this.slidesContainer.querySelectorAll(".carousel-slide:not([data-clone])")
    );

    // 마지막 슬라이드의 복제본을 맨 앞에 추가
    const lastSlideClone =
      originalSlides[originalSlides.length - 1].cloneNode(true);
    lastSlideClone.setAttribute("data-clone", "last");
    this.slidesContainer.insertBefore(
      lastSlideClone,
      this.slidesContainer.firstChild
    );

    // 첫 번째 슬라이드의 복제본을 맨 뒤에 추가
    const firstSlideClone = originalSlides[0].cloneNode(true);
    firstSlideClone.setAttribute("data-clone", "first");
    this.slidesContainer.appendChild(firstSlideClone);

    // console.log("🔄 무한 스크롤용 복제본 생성:", {
    //   originalCount: originalSlides.length,
    //   totalCount: this.slidesContainer.children.length,
    // });
  }

  initializeSlides() {
    const settings = this.configManager.getSettings();

    // 스크롤 모드에서 기존 복제본 제거
    if (settings.animationType === "scroll") {
      const clones = this.slidesContainer.querySelectorAll("[data-clone]");
      clones.forEach((clone) => clone.remove());
    }

    const slides = this.slidesContainer.querySelectorAll(".carousel-slide");

    // console.log("🎬 슬라이드 초기화:", {
    //   animationType: settings.animationType,
    //   slideCount: slides.length,
    // });

    if (settings.animationType === "scroll") {
      // 무한 스크롤 설정
      this.setupInfiniteScroll();

      // 컨테이너 기준 너비 계산
      const containerWidth = this.container.offsetWidth;
      const allSlides =
        this.slidesContainer.querySelectorAll(".carousel-slide");

      // 모든 슬라이드 스타일 적용
      allSlides.forEach((slide, index) => {
        slide.classList.add("active");
        slide.style.display = "block";
        slide.style.opacity = "1";
        slide.style.width = `${containerWidth}px`;
        slide.style.flexBasis = `${containerWidth}px`;
        slide.style.flexShrink = "0";
        slide.style.minWidth = `${containerWidth}px`;
      });

      // 슬라이드 컨테이너를 flex로 설정하고 전체 너비 계산
      this.slidesContainer.style.display = "flex";
      this.slidesContainer.style.width = `${
        allSlides.length * containerWidth
      }px`;
      this.slidesContainer.style.flexDirection = "row";
      this.slidesContainer.style.transition = `transform ${settings.transitionDuration}ms ease-in-out`;

      console.log(
        `📏 컨테이너 총 너비: ${
          allSlides.length * containerWidth
        }px (슬라이드 ${allSlides.length}개 × ${containerWidth}px)`
      );

      // 첫 번째 슬라이드로 스크롤 위치 설정 (복제본이 앞에 있으므로 오프셋 필요)
      const initialOffset = -containerWidth; // 앞쪽 복제본 1개 건너뛰기
      this.slidesContainer.style.transform = `translateX(${initialOffset}px)`;
      this.realIndex = 1; // 실제로는 두 번째 위치 (첫 번째 원본)
      console.log("🔄 스크롤 위치를 복제본 다음으로 설정:", {
        initialOffset,
        realIndex: this.realIndex,
      });
    } else {
      // 페이드 모드에서는 첫 번째 슬라이드만 활성화
      slides.forEach((slide, index) => {
        // 모든 슬라이드에 transition 설정
        slide.style.transition = `opacity ${settings.transitionDuration}ms ease-in-out, transform ${settings.transitionDuration}ms ease-in-out`;
        slide.style.display = "block"; // 페이드 모드에서는 모든 슬라이드가 화면에 있어야 함

        if (index === 0) {
          slide.classList.add("active");
          slide.style.opacity = "1";
          slide.style.zIndex = "2";
          // console.log(`✨ 첫 번째 슬라이드 활성화`);
        } else {
          slide.classList.remove("active");
          slide.style.opacity = "0";
          slide.style.zIndex = "1";
        }
        // 페이드 모드에서는 기본 스타일로 복원
        slide.style.width = "";
        slide.style.flexBasis = "";
        slide.style.flexShrink = "";
        slide.style.minWidth = "";
      });

      // 페이드 모드에서는 기본 컨테이너 스타일로 복원
      this.slidesContainer.style.width = "";
      this.slidesContainer.style.flexDirection = "";
      this.slidesContainer.style.transition = "";
    }

    // 첫 번째 인디케이터 활성화
    const indicators = this.indicators.querySelectorAll(".carousel-indicator");
    indicators.forEach((indicator, index) => {
      if (index === 0) {
        indicator.classList.add("active");
      } else {
        indicator.classList.remove("active");
      }
    });

    this.currentIndex = 0;

    console.log("✅ 슬라이드 초기화 완료, currentIndex:", this.currentIndex);

    // 버튼 상태 업데이트
    this.updateButtonStates();
  }

  updateSlide(newIndex, direction = "next") {
    if (this.isTransitioning || this.images.length === 0) return;

    this.isTransitioning = true;
    const settings = this.configManager.getSettings();

    if (settings.animationType === "scroll") {
      this.updateSlideScroll(newIndex);
    } else {
      this.updateSlideFade(newIndex);
    }

    // 인덱스 변경 이벤트 발생 (인덱스 업데이트 후)
    console.log("🔔 slideChanged 이벤트 발생:", {
      currentIndex: this.currentIndex,
      totalImages: this.images.length,
      newIndex: newIndex,
    });
    this.container.dispatchEvent(
      new CustomEvent("slideChanged", {
        detail: {
          currentIndex: this.currentIndex,
          totalImages: this.images.length,
        },
      })
    );

    // 전환 완료 후 플래그 리셋
    setTimeout(() => {
      this.isTransitioning = false;
      // Fallback: if auto-play is enabled and interval is missing, restart it
      const settings = this.configManager.getSettings();
      if (
        settings.autoPlay &&
        this.images.length > 1 &&
        !this.intervalId &&
        this.isPlaying
      ) {
        this.startAutoPlay();
      }
    }, this.configManager.getSettings().transitionDuration);

    // 다음 이미지 프리로딩 (성능 최적화)
    this.preloadNextImages();

    // 버튼 상태 업데이트
    this.updateButtonStates();
  }

  updateSlideFade(newIndex) {
    const slides = this.slidesContainer.querySelectorAll(".carousel-slide");
    const indicators = this.indicators.querySelectorAll(".carousel-indicator");
    const settings = this.configManager.getSettings();

    // 모든 슬라이드에 transition 속성 강제 적용
    slides.forEach((slide) => {
      slide.style.transition = `opacity ${settings.transitionDuration}ms ease-in-out, transform ${settings.transitionDuration}ms ease-in-out`;
      slide.style.display = "block"; // 페이드 모드에서는 모든 슬라이드가 보이도록
    });

    // 모든 슬라이드를 먼저 숨김 (새로운 슬라이드 제외)
    slides.forEach((slide, index) => {
      if (index !== newIndex) {
        slide.classList.remove("active");
        slide.style.zIndex = "1";
        slide.style.opacity = "0";
      }
    });

    // 이전 인디케이터 비활성화
    indicators[this.currentIndex]?.classList.remove("active");

    // 인덱스 업데이트
    this.currentIndex = newIndex;

    // 새 슬라이드 활성화
    if (slides[this.currentIndex]) {
      slides[this.currentIndex].classList.add("active");
      slides[this.currentIndex].style.zIndex = "2";
      slides[this.currentIndex].style.opacity = "1";
    }
    indicators[this.currentIndex]?.classList.add("active");
  }

  updateSlideScroll(newIndex) {
    const settings = this.configManager.getSettings();
    const indicators = this.indicators.querySelectorAll(".carousel-indicator");

    console.log("📐 updateSlideScroll 호출:", {
      currentIndex: this.currentIndex,
      newIndex: newIndex,
      realIndex: this.realIndex,
    });

    // 이전 인디케이터 비활성화
    indicators[this.currentIndex]?.classList.remove("active");

    // 인덱스 업데이트
    const oldIndex = this.currentIndex;
    this.currentIndex = newIndex;

    // 새 인디케이터 활성화
    indicators[this.currentIndex]?.classList.add("active");

    const slideWidth = this.container.offsetWidth;

    // realIndex가 초기화되지 않은 경우 설정
    if (typeof this.realIndex !== "number" || this.realIndex === 0) {
      this.realIndex = 1; // 첫 번째 원본 위치
      console.log("🔧 realIndex 초기화:", this.realIndex);
    }

    // 실제 스크롤 위치 계산 (복제본 고려)
    if (oldIndex === this.images.length - 1 && newIndex === 0) {
      // 마지막에서 첫 번째로 (오른쪽으로 계속)
      this.realIndex = this.images.length + 1; // 마지막 복제본으로
      const translateX = -this.realIndex * slideWidth;

      console.log("🔄 무한 루프 (마지막→첫번째):", {
        realIndex: this.realIndex,
        translateX,
      });

      this.slidesContainer.style.transform = `translateX(${translateX}px)`;

      // 애니메이션 완료 후 실제 첫 번째 위치로 순간이동
      setTimeout(() => {
        this.realIndex = 1; // 첫 번째 원본 위치
        this.slidesContainer.style.transition = "none";
        this.slidesContainer.style.transform = `translateX(${
          -this.realIndex * slideWidth
        }px)`;

        // 더블 requestAnimationFrame으로 확실한 렌더링 보장
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            this.slidesContainer.style.transition = `transform ${settings.transitionDuration}ms ease-in-out`;
          });
        });

        console.log("🔄 위치 리셋:", { realIndex: this.realIndex });
      }, settings.transitionDuration + 10); // 설정된 전환 시간 + 약간의 여유
    } else if (
      oldIndex === 0 &&
      newIndex === this.images.length - 1 &&
      this.images.length > 2
    ) {
      // 첫 번째에서 마지막으로 (왼쪽으로 계속) - 3장 이상일 때만
      this.realIndex = 0; // 앞쪽 복제본으로
      const translateX = -this.realIndex * slideWidth;

      console.log("🔄 무한 루프 (첫번째→마지막):", {
        realIndex: this.realIndex,
        translateX,
      });

      this.slidesContainer.style.transform = `translateX(${translateX}px)`;

      // 애니메이션 완료 후 실제 마지막 위치로 순간이동
      setTimeout(() => {
        this.realIndex = this.images.length; // 마지막 원본 위치
        this.slidesContainer.style.transition = "none";
        this.slidesContainer.style.transform = `translateX(${
          -this.realIndex * slideWidth
        }px)`;

        // 더블 requestAnimationFrame으로 확실한 렌더링 보장
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            this.slidesContainer.style.transition = `transform ${settings.transitionDuration}ms ease-in-out`;
          });
        });

        console.log("🔄 위치 리셋:", { realIndex: this.realIndex });
      }, settings.transitionDuration + 10); // 설정된 전환 시간 + 약간의 여유
    } else {
      // 일반적인 이동
      this.realIndex = newIndex + 1; // 복제본 1개 오프셋
      const translateX = -this.realIndex * slideWidth;

      console.log("🔄 일반 스크롤:", { realIndex: this.realIndex, translateX });

      this.slidesContainer.style.transform = `translateX(${translateX}px)`;
    }
  }

  async preloadNextImages() {
    const settings = this.configManager.getSettings();
    if (!settings.infiniteLoop) return;

    // 다음 2-3개 이미지 프리로딩
    for (let i = 1; i <= 3; i++) {
      const nextIndex = (this.currentIndex + i) % this.images.length;
      const imageData = this.images[nextIndex];

      if (imageData && !this.preloadedImages.has(imageData.path)) {
        try {
          const img = new Image();
          const actualImageSrc = await this.configManager.getImageData(
            imageData.path
          );
          img.onload = () => this.preloadedImages.set(imageData.path, img);
          img.src = actualImageSrc;
        } catch (error) {
          console.error("이미지 프리로딩 실패:", error);
          const img = new Image();
          img.onload = () => this.preloadedImages.set(imageData.path, img);
          img.src = imageData.path; // 폴백
        }
      }
    }
  }

  nextSlide() {
    if (this.images.length === 0) return;

    const nextIndex = (this.currentIndex + 1) % this.images.length;
    this.updateSlide(nextIndex, "next");
  }

  previousSlide() {
    if (this.images.length === 0) return;

    // 2장일 때는 이전 슬라이드 비활성화 (오른쪽으로만 무한 스크롤)
    if (this.images.length === 2) return;

    const prevIndex =
      (this.currentIndex - 1 + this.images.length) % this.images.length;
    this.updateSlide(prevIndex, "prev");
  }

  goToSlide(index) {
    if (index < 0 || index >= this.images.length || index === this.currentIndex)
      return;

    const direction = index > this.currentIndex ? "next" : "prev";
    this.updateSlide(index, direction);
  }

  startAutoPlay() {
    const settings = this.configManager.getSettings();
    if (!settings.autoPlay || this.images.length <= 1) {
      this.pauseAutoPlay();
      return;
    }

    // 기존 interval 제거 후 새로 설정
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.isPlaying = true;
    this.playPauseBtn.textContent = "⏸️";
    this.playPauseBtn.title = "일시정지 (스페이스)";

    this.intervalId = setInterval(() => {
      // Fallback: if auto-play is enabled and interval is missing, restart it
      if (!this.isPlaying) {
        this.startAutoPlay();
        return;
      }
      this.nextSlide();
    }, settings.slideInterval);
  }

  pauseAutoPlay() {
    this.isPlaying = false;
    this.playPauseBtn.textContent = "▶️";
    this.playPauseBtn.title = "재생 (스페이스)";

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  togglePlayPause() {
    if (this.isPlaying) {
      this.pauseAutoPlay();
    } else {
      this.startAutoPlay();
    }
  }

  updateControlsVisibility() {
    const settings = this.configManager.getSettings();

    if (settings.showControls) {
      this.controls.classList.remove("hidden");
    } else {
      this.controls.classList.add("hidden");
      // 컨트롤이 숨겨지면 키보드 도움말도 숨김
      this.hideKeyboardHelp();
    }

    if (settings.showIndicators) {
      this.indicatorsContainer.classList.remove("hidden");
    } else {
      this.indicatorsContainer.classList.add("hidden");
    }
  }

  updateFromConfig() {
    this.applyStyles();
    this.updateControlsVisibility();

    // 애니메이션 타입이 변경되면 슬라이드 재초기화
    if (this.images.length > 0) {
      this.initializeSlides();
    }

    // 항상 autoPlay 설정에 따라 재시작
    this.pauseAutoPlay();
    const settings = this.configManager.getSettings();
    if (settings.autoPlay && this.images.length > 1) {
      this.startAutoPlay();
    }

    // 이미지 목록이 실제로 변경되었을 때만 다시 로드
    const currentImages = this.configManager.getActiveImages();
    const currentImagePaths = currentImages
      .map((img) => img.path)
      .sort()
      .join(",");
    const existingImagePaths = this.images
      .map((img) => img.path)
      .sort()
      .join(",");

    if (currentImagePaths !== existingImagePaths) {
      // console.log("🔄 이미지 목록 변경 감지, 다시 로딩...");
      this.loadImages();
    } else {
      // console.log("✅ 이미지 목록 변경 없음, 로딩 생략");
    }
  }
  updateStatus(message, progress) {
    this.statusText.textContent = message;
    this.progressBar.style.width = `${progress}%`;
    this.container.querySelector(".carousel-status").classList.remove("hidden");
  }

  hideStatus() {
    this.container.querySelector(".carousel-status").classList.add("hidden");
  }

  // 정리 메서드
  destroy() {
    // console.log("🧹 CarouselSlider 메모리 정리 시작...");

    // 1. 자동 재생 정리
    this.pauseAutoPlay();

    // 2. 프리로딩된 이미지 정리 (Blob URL 해제)
    this.preloadedImages.clear();

    // 3. 이벤트 리스너 제거
    if (this.keyboardHandler) {
      document.removeEventListener("keydown", this.keyboardHandler);
    }
    if (this.focusHandler) {
      window.removeEventListener("focus", this.focusHandler);
    }
    if (this.blurHandler) {
      window.removeEventListener("blur", this.blurHandler);
    }

    // 4. 요소 이벤트 리스너 제거
    if (this.prevBtn) {
      this.prevBtn.removeEventListener("click", this.prevClickHandler);
    }
    if (this.nextBtn) {
      this.nextBtn.removeEventListener("click", this.nextClickHandler);
    }
    if (this.playPauseBtn) {
      this.playPauseBtn.removeEventListener(
        "click",
        this.playPauseClickHandler
      );
    }
    if (this.slidesContainer) {
      this.slidesContainer.removeEventListener(
        "touchstart",
        this.touchStartHandler
      );
      this.slidesContainer.removeEventListener(
        "touchend",
        this.touchEndHandler
      );
      this.slidesContainer.removeEventListener("click", this.clickHandler);
    }

    // 5. ConfigManager 이벤트 리스너 제거
    if (this.configManager && this.configChangeHandler) {
      this.configManager.removeEventListener(
        "configChanged",
        this.configChangeHandler
      );
    }

    // 6. DOM 정리
    if (this.container) {
      this.container.innerHTML = "";
    }

    // 7. 참조 정리
    this.container = null;
    this.configManager = null;
    this.slidesContainer = null;
    this.indicators = null;
    this.prevBtn = null;
    this.nextBtn = null;
    this.playPauseBtn = null;
    this.statusText = null;
    this.progressBar = null;
    this.controls = null;
    this.indicatorsContainer = null;
    this.images = [];

    // console.log("✅ CarouselSlider 메모리 정리 완료");
  }

  updateButtonStates() {
    // 2장일 때 이전 버튼 비활성화
    if (this.images.length === 2) {
      this.prevBtn.classList.add("disabled");
      this.prevBtn.title = "2장 모드에서는 오른쪽으로만 무한 스크롤됩니다";
    } else {
      this.prevBtn.classList.remove("disabled");
      this.prevBtn.title = "이전 이미지 (←)";
    }
  }
}

// 전역에서 사용할 수 있도록 export
window.CarouselSlider = CarouselSlider;
