class ConfigManager {
  constructor() {
    this.config = null;
    this.listeners = new Set();
    this.isSupported = "showOpenFilePicker" in window;
    this.fileHandle = null;
    this.directoryHandle = null; // 디렉토리 핸들 캐시
    this.directoryHandleKey = "carousel-directory-handle"; // localStorage 키
    this.backupInterval = 30000; // 30초마다 자동 백업
    this.backupIntervalId = null; // 백업 interval ID 저장
    this.saveTimeout = null; // config.json 저장 debounce용
    this.imageCache = new Map(); // 이미지 blob URL 캐시
    this.imageCacheTimeout = 300000; // 5분 후 캐시 만료

    // config.json 파일 감시를 위한 속성들
    this.configWatchInterval = 1000; // 1초마다 체크
    this.configWatchIntervalId = null;
    this.lastConfigModified = null; // 마지막 수정 시간 추적

    this.init();
  }

  async init() {
    try {
      // 1순위: 저장된 디렉토리 핸들 로드 (관리 도구에서 중요)
      await this.loadDirectoryHandle();

      let configLoaded = false;

      // 2순위: File System API로 config.json 로드 시도
      if (this.directoryHandle) {
        configLoaded = await this.loadConfigFromDirectory();
      }

      // 3순위: fetch로 config.json 파일에서 로드 시도 (CORS 회피용)
      if (!configLoaded) {
        configLoaded = await this.loadConfigFromFileSilent();
      }

      if (!configLoaded) {
        // 4순위: 기본 설정으로 생성 (디렉토리 핸들이 있으면 자동 저장됨)
        // console.log("config.json 파일이 없어 기본 설정으로 시작");
        this.createDefaultConfig();

        // 디렉토리 핸들이 있으면 즉시 config.json 저장
        if (this.directoryHandle) {
          // console.log(
          //   "디렉토리 핸들이 복원되어 config.json을 즉시 저장합니다."
          // );
          await this.saveConfigToFile();

          // 기존 이미지들을 스캔해서 자동으로 추가
          // console.log("기존 이미지들을 자동 스캔합니다...");
          await this.scanExistingImages();
        }
      }

      this.startAutoBackup();
      this.startConfigFileWatcher(); // config.json 파일 감시 시작
    } catch (error) {
      console.warn("Config 초기화 실패:", error);
      this.createDefaultConfig();
    }
  }

  // File System API로 디렉토리에서 config.json 로드
  async loadConfigFromDirectory() {
    if (!this.directoryHandle) {
      // console.log("디렉토리 핸들이 없어 File System API 로드를 건너뜁니다");
      return false;
    }

    try {
      // console.log("File System API로 images/config.json 직접 로드 시도...");

      // images 폴더에서 config.json 파일 직접 읽기
      const configFileHandle = await this.directoryHandle.getFileHandle(
        "config.json"
      );
      const configFile = await configFileHandle.getFile();
      const configText = await configFile.text();
      const configData = JSON.parse(configText);

      // console.log("✅ File System API로 config.json 직접 로드 성공");
      // console.log("📋 로드된 config 정보:", {
      //   totalImages: configData.images?.length || 0,
      //   activeImages:
      //     configData.images?.filter((img) => img.enabled)?.length || 0,
      //   sampleImages:
      //     configData.images
      //       ?.slice(0, 3)
      //       .map((img) => ({ filename: img.filename, path: img.path })) || [],
      // });

      this.config = configData;
      this.validateConfig();
      return true;
    } catch (error) {
      if (error.name === "NotFoundError") {
        // console.log("images 폴더에 config.json 파일이 없습니다");
      } else {
        console.warn("File System API로 config.json 로드 실패:", error.message);
      }
      return false; // fetch 방식으로 fallback
    }
  }

  // 자동 로드용 (파일 선택 다이얼로그 없이)
  async loadConfigFromFileSilent() {
    try {
      // console.log("images/config.json 파일 자동 로드 시도...");

      // images 폴더의 config.json을 fetch로 시도
      const response = await fetch("./images/config.json");

      if (!response.ok) {
        if (response.status === 404) {
          // console.log("images/config.json 파일이 존재하지 않습니다");
          return false;
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const configData = await response.json();
      // console.log("✅ fetch로 images/config.json 자동 로드 성공");
      // console.log("📋 로드된 config 정보:", {
      //   totalImages: configData.images?.length || 0,
      //   activeImages:
      //     configData.images?.filter((img) => img.enabled)?.length || 0,
      //   sampleImages:
      //     configData.images
      //       ?.slice(0, 3)
      //       .map((img) => ({ filename: img.filename, path: img.path })) || [],
      // });

      this.config = configData;
      this.validateConfig();
      return true;
    } catch (error) {
      console.warn("images/config.json 자동 로드 실패:", error.message);

      // CORS 에러인 경우 사용자에게 안내
      if (error.message.includes("CORS") || error.message.includes("fetch")) {
        // console.log(
        //   "🌐 로컬 파일에서 실행 중 - images/config.json 파일을 직접 선택해야 합니다."
        // );
      }

      return false;
    }
  }

  // 사용자가 명시적으로 config.json 파일을 선택할 때 사용
  async loadConfigFromFile() {
    try {
      // console.log("사용자 요청으로 config.json 파일 선택...");

      // File System Access API 지원 여부 확인
      if (!this.isSupported) {
        console.error("❌ File System Access API가 지원되지 않습니다.");
        alert(
          "이 브라우저는 파일 선택 기능을 지원하지 않습니다.\nHTTP 서버를 통해 실행하거나 작업 폴더에 슬라이드.html을 복사해서 실행해주세요."
        );
        return false;
      }

      // File System Access API를 사용하여 config.json 선택
      const [fileHandle] = await window.showOpenFilePicker({
        types: [
          {
            description: "JSON 설정 파일",
            accept: { "application/json": [".json"] },
          },
        ],
        excludeAcceptAllOption: true,
        suggestedName: "config.json",
      });

      const file = await fileHandle.getFile();
      const configText = await file.text();
      const configData = JSON.parse(configText);

      // console.log("✅ 사용자 선택으로 config.json 로드 성공");
      // console.log("📁 선택된 파일:", file.name);
      // console.log("📋 로드된 config 정보:", {
      //   totalImages: configData.images?.length || 0,
      //   activeImages:
      //     configData.images?.filter((img) => img.enabled)?.length || 0,
      //   sampleImages:
      //     configData.images
      //       ?.slice(0, 3)
      //       .map((img) => ({ filename: img.filename, path: img.path })) || [],
      // });

      this.config = configData;
      this.validateConfig();
      return true;
    } catch (error) {
      if (error.name === "AbortError") {
        // console.log("사용자가 파일 선택을 취소했습니다");
        return false;
      }

      console.error("config.json 파일 선택 및 로드 실패:", error);
      alert(`파일 로드 중 오류가 발생했습니다: ${error.message}`);
      return false;
    }
  }

  createDefaultConfig() {
    this.config = {
      version: "1.0.0",
      settings: {
        autoPlay: true,
        slideInterval: 3000,
        transitionDuration: 800,
        infiniteLoop: true,
        showControls: true,
        showIndicators: true,
        containerWidth: "600px",
        containerHeight: "800px",
        imageResize: "contain",
        objectPosition: "center",
        backgroundColor: "#000000",
        animationType: "scroll", // "fade" 또는 "scroll"
        extraWidth: 0,
        extraHeight: 40,
      },
      images: [], // 빈 배열로 시작 (사용자가 이미지 추가)
      metadata: {
        totalImages: 0,
        activeImages: 0,
        version: "1.0.0",
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        lastBackup: new Date().toISOString(),
      },
    };
    // console.log("✅ 기본 config 생성 완료");
  }

  validateConfig() {
    if (!this.config || typeof this.config !== "object") {
      throw new Error("Invalid config format");
    }

    // 필수 필드 검증
    if (!this.config.settings) this.config.settings = {};
    if (!this.config.images) this.config.images = [];
    if (!this.config.metadata) this.config.metadata = {};

    // 기본값 설정
    const defaultSettings = {
      autoPlay: true,
      slideInterval: 3000,
      transitionDuration: 800,
      infiniteLoop: true,
      showControls: true,
      showIndicators: true,
      containerWidth: "600px",
      containerHeight: "800px",
      imageResize: "contain",
      objectPosition: "center",
      backgroundColor: "#000000",
      animationType: "scroll",
      extraWidth: 0,
      extraHeight: 40,
    };

    this.config.settings = { ...defaultSettings, ...this.config.settings };

    // 레거시 설정 마이그레이션
    let needsSave = false;
    if (this.config.settings.containerWidth === "100%") {
      this.config.settings.containerWidth = "600px";
      // console.log("🔄 containerWidth를 100%에서 600px로 마이그레이션");
      needsSave = true;
    }
    if (
      this.config.settings.containerHeight &&
      !this.config.settings.containerHeight.includes("px")
    ) {
      // 숫자만 있는 경우 px 추가
      if (!isNaN(this.config.settings.containerHeight)) {
        this.config.settings.containerHeight =
          this.config.settings.containerHeight + "px";
        needsSave = true;
      }
    }

    // 마이그레이션이 발생했으면 저장
    if (needsSave) {
      this.saveConfig();
    }

    // 메타데이터 업데이트
    this.updateMetadata();
  }

  updateMetadata() {
    const enabledImages = this.config.images.filter((img) => img.enabled);
    this.config.metadata = {
      ...this.config.metadata,
      totalImages: this.config.images.length,
      activeImages: enabledImages.length,
      lastUpdated: new Date().toISOString(),
    };
  }

  async saveConfig() {
    this.updateMetadata();

    // config.json 파일로 자동 저장 (debounce 적용)
    this.debouncedSaveConfigToFile();

    // 리스너들에게 변경 알림
    this.notifyListeners("configChanged", this.config);
  }

  // debounced config.json 저장 (500ms 대기)
  debouncedSaveConfigToFile() {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    this.saveTimeout = setTimeout(async () => {
      await this.saveConfigToFile();
    }, 200);
  }

  // config.json 파일로 자동 저장하는 메서드
  async saveConfigToFile() {
    // images 폴더 권한이 있을 때만 config.json 저장 시도
    if (!this.directoryHandle) {
      // console.log("디렉토리 권한이 없어 config.json 자동 저장을 건너뜁니다");
      return false;
    }

    try {
      // console.log("config.json 저장 시도...");

      // images 폴더에 config.json 저장
      // console.log("images 폴더에 config.json 저장 중...");
      const fileHandle = await this.directoryHandle.getFileHandle(
        "config.json",
        { create: true }
      );
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(this.config, null, 2));
      await writable.close();

      // console.log("✅ config.json 파일이 images 폴더에 저장되었습니다");
      return true;
    } catch (error) {
      console.warn("config.json 자동 저장 실패:", error.message);
      // console.log(
      //   "💡 수동으로 config.json을 다운로드하거나 프로젝트 루트에 직접 저장해주세요"
      // );
      return false;
    }
  }

  async saveToFile() {
    // 파일 저장은 사용자가 명시적으로 요청했을 때만 수행
    if (!this.fileHandle) {
      // console.log("파일 핸들이 없음 - 파일 저장 생략");
      return;
    }

    try {
      const writable = await this.fileHandle.createWritable();
      await writable.write(JSON.stringify(this.config, null, 2));
      await writable.close();

      // console.log("Config 파일 저장 완료");
    } catch (error) {
      if (error.name !== "AbortError") {
        console.error("파일 저장 오류:", error);
        // 파일 핸들이 무효해졌을 수 있으므로 리셋
        this.fileHandle = null;
      }
    }
  }

  // 사용자가 명시적으로 파일로 저장하고 싶을 때 호출
  async saveToFileExplicit() {
    try {
      this.fileHandle = await window.showSaveFilePicker({
        suggestedName: "config.json",
        types: [
          {
            description: "JSON 설정 파일",
            accept: { "application/json": [".json"] },
          },
        ],
      });

      await this.saveToFile();
      return true;
    } catch (error) {
      if (error.name === "AbortError") {
        // console.log("사용자가 저장을 취소했습니다");
      } else {
        console.error("명시적 저장 실패:", error);
      }
      return false;
    }
  }

  // 이미지 관리 메서드들
  async addImage(imageData, fileObject = null) {
    const newId = Math.max(0, ...this.config.images.map((img) => img.id)) + 1;

    // 실제 파일을 images 폴더에 복사
    let finalPath = imageData.path;
    if (fileObject && this.isSupported) {
      try {
        finalPath = await this.copyImageToFolder(
          fileObject,
          imageData.filename
        );
      } catch (error) {
        console.warn("파일 복사 실패, base64로 대체:", error);
        // 실패 시 base64로 폴백
        finalPath = imageData.path;
      }
    }

    const newImage = {
      id: newId,
      filename: imageData.filename,
      path: finalPath,
      order: this.config.images.length + 1,
      enabled: true,
      alt: imageData.alt || imageData.filename,
      addedDate: new Date().toISOString(),
      fileSize: fileObject ? fileObject.size : null,
      ...imageData,
    };

    this.config.images.push(newImage);
    this.saveConfig();
    return newImage;
  }

  async copyImageToFolder(fileObject, filename) {
    const safeFilename = this.generateSafeFilename(filename);

    // console.log("=== 파일 저장 시작 ===");
    // console.log("파일명:", safeFilename);
    // console.log("디렉토리 핸들 존재:", !!this.directoryHandle);

    try {
      // 디렉토리 핸들이 있는 경우에만 파일 저장
      if (!this.directoryHandle) {
        throw new Error(
          "디렉토리 접근 권한이 없습니다. 먼저 프로젝트 루트폴더의 images 폴더를 선택해주세요."
        );
      }

      // console.log("실제 파일 저장 시도...");
      await this.saveFileToDirectory(fileObject, safeFilename);
      const imagePath = `images/${safeFilename}`;
      console.log(`✅ 이미지가 실제 images 폴더에 저장됨: ${imagePath}`);
      return imagePath;
    } catch (error) {
      console.error("🚨 파일 저장 실패:", error);
      throw error; // 에러를 상위로 전파
    }
  }

  async saveFileToDirectory(fileObject, filename) {
    console.log("saveFileToDirectory 호출됨");
    console.log("디렉토리 핸들:", this.directoryHandle?.name);

    if (!this.directoryHandle) {
      throw new Error("디렉토리 핸들이 없습니다");
    }

    try {
      console.log("images 폴더에 파일 저장 중...");

      // directoryHandle이 이미 images 폴더를 가리키므로 바로 사용
      console.log(`파일 생성 시도: ${filename}`);

      // 파일을 images 폴더에 저장
      const fileHandle = await this.directoryHandle.getFileHandle(filename, {
        create: true,
      });

      console.log("파일 쓰기 시작...");
      const writable = await fileHandle.createWritable();

      await writable.write(fileObject);
      await writable.close();

      console.log(`✅ 파일이 저장됨: ${filename}`);
    } catch (error) {
      console.error("🚨 실제 파일 저장 실패:", error);
      throw error;
    }
  }

  // 이미지 로드 시 실제 데이터 반환
  async getImageData(imagePath) {
    // 캐시 확인
    if (this.imageCache.has(imagePath)) {
      const cached = this.imageCache.get(imagePath);
      if (Date.now() - cached.timestamp < this.imageCacheTimeout) {
        return cached.url;
      } else {
        // 만료된 캐시 정리
        URL.revokeObjectURL(cached.url);
        this.imageCache.delete(imagePath);
      }
    }

    // images/filename 형태의 경로 처리
    if (imagePath.startsWith("images/")) {
      const filename = imagePath.replace("images/", "");

      // File System API로 실제 파일 시스템에서 로드 (폴더 권한이 있는 경우)
      if (this.directoryHandle) {
        try {
          // directoryHandle이 이미 images 폴더를 가리키므로 바로 파일 찾기
          const fileHandle = await this.directoryHandle.getFileHandle(filename);
          const file = await fileHandle.getFile();

          // File 객체를 blob URL로 변환
          const blobUrl = URL.createObjectURL(file);

          // 캐시에 저장
          this.imageCache.set(imagePath, {
            url: blobUrl,
            timestamp: Date.now(),
          });

          return blobUrl;
        } catch (error) {
          // 폴백: 상대 경로로 시도
          return imagePath;
        }
      } else {
        // 폴더 권한이 없는 경우 (슬라이드 창 등) 상대 경로로 반환
        console.log(`폴더 권한 없음, 상대 경로 사용: ${imagePath}`);
        return imagePath;
      }
    }

    // 기존 데이터나 실제 파일 경로인 경우 그대로 반환
    return imagePath;
  }

  generateSafeFilename(filename) {
    // 원본 파일명 사용 (정규화 없음)
    const existingImages = this.config.images.map((img) => img.filename);
    let finalName = filename;

    // 중복된 파일명이 있으면 타임스탬프 추가
    if (existingImages.includes(finalName)) {
      const timestamp = Date.now();
      const nameWithoutExt = filename.replace(/\.[^/.]+$/, "");
      const extension = filename.split(".").pop();
      finalName = `${nameWithoutExt}_${timestamp}.${extension}`;
    }

    return finalName;
  }

  async removeImage(imageId) {
    const index = this.config.images.findIndex((img) => img.id === imageId);
    if (index === -1) return false;

    const removedImage = this.config.images.splice(index, 1)[0];

    // 실제 파일을 deleted 폴더로 이동
    await this.moveImageToDeleted(removedImage.path);

    // 순서 재정렬
    this.config.images.forEach((img, idx) => {
      img.order = idx + 1;
    });

    this.saveConfig();
    return removedImage;
  }

  async moveImageToDeleted(imagePath) {
    console.log("=== 파일 이동 시작 ===");
    console.log("이동할 이미지 경로:", imagePath);

    if (!this.directoryHandle || !imagePath.startsWith("images/")) {
      console.warn(
        "디렉토리 핸들이 없거나 경로가 올바르지 않아 파일 이동을 건너뜁니다."
      );
      return;
    }

    const filename = imagePath.replace("images/", "");

    try {
      // 1. 원본 파일 핸들 가져오기
      const sourceFileHandle = await this.directoryHandle.getFileHandle(
        filename
      );
      const sourceFile = await sourceFileHandle.getFile();

      // 2. 'deleted' 폴더 핸들 가져오기 (없으면 생성)
      const deletedDirHandle = await this.directoryHandle.getDirectoryHandle(
        "deleted",
        { create: true }
      );

      // 3. 대상 파일 핸들 생성 및 파일 쓰기
      const destFileHandle = await deletedDirHandle.getFileHandle(filename, {
        create: true,
      });
      const writable = await destFileHandle.createWritable();
      await writable.write(sourceFile);
      await writable.close();

      // 4. 원본 파일 삭제
      await this.directoryHandle.removeEntry(filename);

      console.log(`✅ 파일이 'images/deleted' 폴더로 이동됨: ${filename}`);
    } catch (error) {
      console.error("🚨 파일 이동 중 오류:", error);
    }
  }

  async deleteImageFile(imagePath) {
    console.log("=== 파일 삭제 시작 ===");
    console.log("삭제할 이미지 경로:", imagePath);

    try {
      // 1순위: 실제 파일 삭제
      if (this.directoryHandle && imagePath.startsWith("images/")) {
        const filename = imagePath.replace("images/", "");
        console.log("실제 파일 삭제 시도:", filename);

        try {
          let targetHandle;

          // 선택된 폴더가 이미  'images' 폴더인지 확인
          if (this.directoryHandle.name === "images") {
            targetHandle = this.directoryHandle;
          } else {
            targetHandle = await this.directoryHandle.getDirectoryHandle(
              "images"
            );
          }

          await targetHandle.removeEntry(filename);
          console.log("✅ 실제 파일이 삭제됨:", filename);
        } catch (error) {
          console.warn("실제 파일 삭제 실패:", error);
        }
      }
    } catch (error) {
      console.error("🚨 파일 삭제 중 오류:", error);
    }
  }

  // 설정만 초기화하는 메서드 (실제 파일은 삭제하지 않음)
  async resetConfigOnly() {
    console.log("=== 설정 전용 초기화 시작 ===");
    console.log("실제 파일은 삭제하지 않고 config만 초기화합니다.");

    // config의 이미지 목록만 비우기 (실제 파일 삭제는 하지 않음)
    this.config.images = [];

    // 기본 설정으로 되돌리기
    this.createDefaultConfig();

    // 폴더 정보도 함께 초기화
    await this.clearDirectoryAccess();

    console.log("✅ 설정 초기화 완료 (파일은 보존됨, 폴더 정보 초기화됨)");

    return {
      success: true,
      message:
        "설정이 초기화되었습니다. 실제 파일은 보존되며, 폴더를 다시 선택해주세요.",
    };
  }

  // 폴더 접근 권한 검증 (권한 상실 시 자동 정리)
  async validateDirectoryAccess() {
    if (!this.directoryHandle) {
      return false;
    }

    try {
      // 권한 상태 확인
      const permission = await this.directoryHandle.queryPermission({
        mode: "readwrite",
      });

      if (permission !== "granted") {
        console.log("🔄 폴더 권한이 변경됨:", permission);
        await this.clearDirectoryAccess();
        return false;
      }

      // 실제 접근 가능한지 테스트
      await this.directoryHandle.entries().next();
      return true;
    } catch (error) {
      console.log("❌ 폴더 접근 권한 검증 실패:", error.message);
      await this.clearDirectoryAccess();
      return false;
    }
  }

  // 폴더 접근 권한 및 저장된 정보 초기화
  async clearDirectoryAccess() {
    console.log("=== 폴더 접근 정보 초기화 ===");

    // 메모리의 핸들 정리
    this.directoryHandle = null;

    // localStorage 정리
    localStorage.removeItem(this.directoryHandleKey);

    // IndexedDB 정리
    await this.clearStoredDirectoryHandle();

    console.log("✅ 폴더 접근 정보가 모두 초기화되었습니다");
  }

  // 모든 이미지 파일을 삭제하는 메서드
  async clearAllImages() {
    console.log("=== 모든 이미지 삭제 시작 ===");

    if (!this.config.images || this.config.images.length === 0) {
      console.log("삭제할 이미지가 없습니다.");
      return { success: true, deleted: 0, errors: 0 };
    }

    let deletedCount = 0;
    let errorCount = 0;
    const totalImages = this.config.images.length;

    // 모든 이미지를 순차적으로 삭제
    for (const image of [...this.config.images]) {
      try {
        console.log(`이미지 삭제 중: ${image.filename}`);
        await this.deleteImageFile(image.path);
        deletedCount++;
      } catch (error) {
        console.error(`이미지 삭제 실패: ${image.filename}`, error);
        errorCount++;
      }
    }

    // config에서 모든 이미지 제거
    this.config.images = [];
    this.saveConfig();

    console.log("=== 모든 이미지 삭제 완료 ===");
    console.log(`총 이미지: ${totalImages}개`);
    console.log(`삭제 성공: ${deletedCount}개`);
    console.log(`삭제 실패: ${errorCount}개`);

    return {
      success: true,
      total: totalImages,
      deleted: deletedCount,
      errors: errorCount,
    };
  }

  updateImageOrder(imageId, newOrder) {
    const image = this.config.images.find((img) => img.id === imageId);
    if (!image) return false;

    // 기존 순서에서 제거
    this.config.images.splice(image.order - 1, 1);

    // 새 위치에 삽입
    this.config.images.splice(newOrder - 1, 0, image);

    // 모든 이미지 순서 재정렬
    this.config.images.forEach((img, idx) => {
      img.order = idx + 1;
    });

    this.saveConfig();
    return true;
  }

  updateImageEnabled(imageId, enabled) {
    const image = this.config.images.find((img) => img.id === imageId);
    if (!image) return false;

    image.enabled = enabled;
    this.saveConfig();
    return true;
  }

  // 설정 관리 메서드들
  updateSetting(key, value) {
    if (!this.config.settings.hasOwnProperty(key)) {
      console.warn(`Unknown setting: ${key}`);
      return false;
    }

    this.config.settings[key] = value;
    this.saveConfig();
    return true;
  }

  updateSettings(newSettings) {
    this.config.settings = { ...this.config.settings, ...newSettings };
    this.saveConfig();
  }

  // 백업 및 복원
  exportConfig() {
    const blob = new Blob([JSON.stringify(this.config, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `carousel-config-${
      new Date().toISOString().split("T")[0]
    }.json`;
    a.click();

    URL.revokeObjectURL(url);
  }

  async importConfig(file) {
    try {
      const text = await file.text();
      const importedConfig = JSON.parse(text);

      // 백업 생성
      const backup = { ...this.config };
      localStorage.setItem("carousel-config-backup", JSON.stringify(backup));

      // 새 설정 적용
      this.config = importedConfig;
      this.validateConfig();
      await this.saveConfig();

      this.notifyListeners("configImported", this.config);
      return true;
    } catch (error) {
      console.error("Config 가져오기 실패:", error);
      return false;
    }
  }

  restoreBackup() {
    try {
      const backup = localStorage.getItem("carousel-config-backup");
      if (backup) {
        this.config = JSON.parse(backup);
        this.validateConfig();
        this.saveConfig();
        return true;
      }
    } catch (error) {
      console.error("백업 복원 실패:", error);
    }
    return false;
  }

  startAutoBackup() {
    this.backupIntervalId = setInterval(() => {
      this.config.metadata.lastBackup = new Date().toISOString();
      localStorage.setItem(
        "carousel-config-auto-backup",
        JSON.stringify(this.config)
      );
      // 만료된 이미지 캐시 정리
      this.cleanExpiredCache();
    }, this.backupInterval);
  }

  // 이벤트 리스너 관리
  addEventListener(event, callback) {
    this.listeners.add({ event, callback });
  }

  removeEventListener(event, callback) {
    this.listeners.forEach((listener) => {
      if (listener.event === event && listener.callback === callback) {
        this.listeners.delete(listener);
      }
    });
  }

  notifyListeners(event, data) {
    this.listeners.forEach((listener) => {
      if (listener.event === event) {
        try {
          listener.callback(data);
        } catch (error) {
          console.error("Listener 실행 오류:", error);
        }
      }
    });
  }

  // Getter 메서드들
  getConfig() {
    return this.config;
  }

  getSettings() {
    return this.config?.settings || {};
  }

  getImages() {
    return this.config?.images || [];
  }

  getActiveImages() {
    return this.getImages().filter((img) => img.enabled);
  }

  getMetadata() {
    return this.config?.metadata || {};
  }

  isFileSystemSupported() {
    return this.isSupported;
  }

  // 디렉토리 핸들 관리 메서드들
  async loadDirectoryHandle() {
    console.log("=== 디렉토리 핸들 로드 시작 ===");
    console.log("File System API 지원:", this.isSupported);

    if (!this.isSupported) {
      console.log("❌ File System API 미지원");
      return false;
    }

    try {
      const handleData = localStorage.getItem(this.directoryHandleKey);
      console.log("저장된 핸들 데이터:", handleData);

      if (!handleData) {
        console.log("❌ 저장된 핸들 데이터 없음");
        return false;
      }

      // IndexedDB에서 핸들 복원 시도
      console.log("IndexedDB에서 핸들 복원 시도...");
      const handle = await this.getStoredDirectoryHandle();

      if (handle) {
        console.log("핸들 발견:", handle.name);
        // 권한 확인
        const permission = await handle.queryPermission({ mode: "readwrite" });
        console.log("권한 상태:", permission);

        if (permission === "granted") {
          // 실제 접근 가능한지 테스트
          try {
            // 폴더에 실제로 접근해보기
            await handle.entries().next();
            this.directoryHandle = handle;
            console.log("✅ 저장된 디렉토리 핸들 복원 성공:", handle.name);
            console.log(
              "🔄 권한 상태: 브라우저가 이전 권한을 기억하고 있어 자동으로 복원되었습니다"
            );
            return true;
          } catch (accessError) {
            console.log(
              "❌ 핸들은 있지만 실제 접근 불가 (권한 만료):",
              accessError.message
            );
            // 만료된 핸들 정리
            await this.clearDirectoryAccess();
          }
        } else if (permission === "prompt") {
          console.log("🔄 권한 재요청 필요 - 저장된 정보 정리");
          // 권한을 다시 요청해야 하는 상태이므로 기존 정보 정리
          await this.clearDirectoryAccess();
        } else {
          console.log("❌ 권한 없음");
          // 권한이 없는 핸들 정리
          await this.clearDirectoryAccess();
        }
      } else {
        console.log("❌ IndexedDB에서 핸들 복원 실패");
        // 복원 실패한 정보 정리
        await this.clearDirectoryAccess();
      }
    } catch (error) {
      console.error("🚨 디렉토리 핸들 로드 실패:", error);
      // 오류 발생 시 저장된 정보 정리
      await this.clearDirectoryAccess();
    }
    return false;
  }

  async requestImagesPermission() {
    if (!this.isSupported) {
      throw new Error("File System Access API가 지원되지 않습니다.");
    }

    // 이미 올바른 프로젝트 폴더가 선택된 경우 변경 불허
    if (!this.canChangeDirectory()) {
      const currentFolder = this.getDirectoryName();
      alert(
        `🔒 폴더 변경이 제한됩니다!\n\n` +
          `현재 선택된 폴더: ${currentFolder}\n\n` +
          `보안상의 이유로 올바른 프로젝트 images 폴더가 이미 선택된 경우\n` +
          `다른 폴더로 변경할 수 없습니다.\n\n` +
          `💡 다른 프로젝트를 사용하려면:\n` +
          `1. 브라우저 새로고침 후 다시 시도하거나\n` +
          `2. 새 브라우저 탭에서 해당 프로젝트를 열어주세요.`
      );
      return {
        success: false,
        error: {
          name: "PermissionDenied",
          message: "올바른 프로젝트 폴더가 이미 선택되어 변경이 제한됩니다.",
        },
      };
    }

    try {
      // 폴더 선택 안내 메시지
      const userConfirmed = confirm(
        "📁 프로젝트 루트 폴더 안에 있는 'images' 폴더를 선택해주세요.\n\n" +
          "⚠️ 주의사항:\n" +
          "• 반드시 현재 프로젝트 루트 폴더 안의 images 폴더여야 합니다\n" +
          "• 다른 프로젝트나 위치의 images 폴더는 작동하지 않습니다\n" +
          "• 선택 후 프로젝트 위치가 자동으로 검증됩니다\n" +
          "• 올바른 폴더 선택 시 보안상 변경이 제한됩니다\n\n" +
          "계속하시겠습니까?"
      );

      if (!userConfirmed) {
        return { success: false, error: { name: "AbortError" } };
      }

      // 프로젝트 루트폴더의 images 폴더 선택 요청
      this.directoryHandle = await window.showDirectoryPicker({
        id: "carousel-images",
        mode: "readwrite",
        startIn: "desktop",
      });

      // 선택된 폴더가 올바른 images 폴더인지 검증
      const validationResult = await this.validateSelectedImagesFolder();
      if (!validationResult.isValid) {
        // 잘못된 폴더 선택 시 사용자에게 안내
        alert(
          "❌ 잘못된 폴더가 선택되었습니다!\n\n" +
            validationResult.message +
            "\n\n" +
            "💡 올바른 선택 방법:\n" +
            "1. 현재 실행 중인 프로젝트의 루트 폴더로 이동\n" +
            "2. 그 안에 있는 'images' 폴더를 선택\n" +
            "3. images 폴더는 슬라이드 이미지들이 있는 폴더여야 합니다\n\n" +
            "다시 시도해주세요."
        );

        // 잘못된 핸들 정리
        this.directoryHandle = null;
        return { success: false, error: validationResult };
      }

      // 디렉토리 핸들 저장
      await this.storeDirectoryHandle(this.directoryHandle);
      localStorage.setItem(
        this.directoryHandleKey,
        JSON.stringify({
          name: this.directoryHandle.name,
          kind: this.directoryHandle.kind,
          saved: new Date().toISOString(),
        })
      );

      console.log("✅ 프로젝트 images 폴더 선택됨:", this.directoryHandle.name);
      console.log("🔒 폴더 변경이 제한됩니다 (보안 유지)");

      // 기존 이미지들을 자동으로 스캔
      const scanResult = await this.scanExistingImages();
      console.log("📁 이미지 스캔 결과:", scanResult);

      return { success: true, scanResult };
    } catch (error) {
      if (error.name !== "AbortError") {
        console.error("images 폴더 선택 실패:", error);
      }
      return { success: false, error };
    }
  }

  // 선택된 폴더가 올바른 images 폴더인지 검증
  async validateSelectedImagesFolder() {
    if (!this.directoryHandle) {
      return {
        isValid: false,
        message: "폴더가 선택되지 않았습니다.",
      };
    }

    try {
      // 1. 폴더 이름이 'images'인지 확인
      if (this.directoryHandle.name !== "images") {
        return {
          isValid: false,
          message: `선택된 폴더명이 '${this.directoryHandle.name}'입니다.\n'images' 폴더를 선택해주세요.`,
        };
      }

      // 2. 프로젝트 루트 폴더인지 위치 기반으로 검증
      const isProjectImagesFolder = await this.isProjectImagesFolder();
      if (!isProjectImagesFolder.isValid) {
        return isProjectImagesFolder;
      }

      // 3. 폴더 내에 이미지 파일들이 있는지 확인
      const imageExtensions = [
        "jpg",
        "jpeg",
        "png",
        "gif",
        "bmp",
        "webp",
        "svg",
      ];
      let hasImages = false;
      let hasOtherFiles = false;

      for await (const [name, handle] of this.directoryHandle.entries()) {
        if (handle.kind === "file") {
          const extension = name.split(".").pop()?.toLowerCase();
          if (extension && imageExtensions.includes(extension)) {
            hasImages = true;
          } else {
            hasOtherFiles = true;
          }
        }
      }

      // 4. 적절한 폴더 구조인지 검증
      if (!hasImages && !hasOtherFiles) {
        return {
          isValid: false,
          message:
            "빈 폴더입니다.\n이미지 파일이 있는 images 폴더를 선택해주세요.",
        };
      }

      if (!hasImages) {
        return {
          isValid: false,
          message:
            "이미지 파일이 없는 폴더입니다.\n슬라이드 이미지가 있는 images 폴더를 선택해주세요.",
        };
      }

      console.log("✅ 올바른 프로젝트 images 폴더 선택됨");
      return {
        isValid: true,
        message: "올바른 프로젝트 images 폴더입니다.",
      };
    } catch (error) {
      console.error("폴더 검증 중 오류:", error);
      return {
        isValid: false,
        message: `폴더 검증 중 오류가 발생했습니다: ${error.message}`,
      };
    }
  }

  // 프로젝트 루트 내의 images 폴더인지 위치 기반으로 검증
  async isProjectImagesFolder() {
    try {
      // 선택된 images 폴더에서 슬라이드 관련 파일들이 있는지 확인
      // 프로젝트 루트에는 슬라이드관리도구.html, 슬라이드.html, carousel-slider.js 등이 있어야 함

      console.log("🔍 프로젝트 위치 검증 시작...");

      // images 폴더에서 상위 디렉토리에 접근할 수 없으므로
      // 대신 images 폴더 내부의 특징적인 파일들로 검증
      let hasConfigJson = false;
      let imageCount = 0;

      for await (const [name, handle] of this.directoryHandle.entries()) {
        if (handle.kind === "file") {
          if (name === "config.json") {
            hasConfigJson = true;
            console.log("✅ config.json 파일 발견");
          }

          // 이미지 파일 개수 확인
          const imageExtensions = [
            "jpg",
            "jpeg",
            "png",
            "gif",
            "bmp",
            "webp",
            "svg",
          ];
          const extension = name.split(".").pop()?.toLowerCase();
          if (extension && imageExtensions.includes(extension)) {
            imageCount++;
          }
        }
      }

      // 추가 검증: 현재 실행 중인 HTML 파일과의 관계 확인
      const currentLocation = window.location.pathname;
      console.log("📍 현재 실행 위치:", currentLocation);

      // 슬라이드관리도구.html 또는 슬라이드.html에서 실행 중인지 확인
      const isRunningFromProject =
        currentLocation.includes("슬라이드관리도구.html") ||
        currentLocation.includes("슬라이드.html") ||
        currentLocation.includes("carousel");

      if (!isRunningFromProject) {
        return {
          isValid: false,
          message:
            "프로젝트 폴더에서 실행되지 않은 것 같습니다.\n슬라이드관리도구.html 파일이 있는 폴더에서 실행해주세요.",
        };
      }

      // 간접적 검증: 이미지가 있고 적절한 구조라면 프로젝트 폴더로 간주
      if (imageCount > 0) {
        console.log(`✅ ${imageCount}개의 이미지 파일 발견`);
        return {
          isValid: true,
          message: `프로젝트 images 폴더로 확인됨 (이미지 ${imageCount}개)`,
        };
      }

      // 빈 images 폴더도 허용 (새 프로젝트일 수 있음)
      console.log("⚠️ 빈 images 폴더이지만 프로젝트 구조로 판단됨");
      return {
        isValid: true,
        message: "빈 프로젝트 images 폴더입니다.",
      };
    } catch (error) {
      console.error("프로젝트 위치 검증 실패:", error);
      return {
        isValid: false,
        message: `프로젝트 위치 검증 중 오류: ${error.message}`,
      };
    }
  }

  async storeDirectoryHandle(handle) {
    // IndexedDB에 핸들 저장
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("CarouselDB", 1);

      request.onerror = () => reject(request.error);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains("directoryHandles")) {
          db.createObjectStore("directoryHandles");
        }
      };

      request.onsuccess = (event) => {
        const db = event.target.result;
        const transaction = db.transaction(["directoryHandles"], "readwrite");
        const store = transaction.objectStore("directoryHandles");

        store.put(handle, "imagesDirectory");

        transaction.oncomplete = () => {
          db.close();
          resolve();
        };

        transaction.onerror = () => {
          db.close();
          reject(transaction.error);
        };
      };
    });
  }

  async getStoredDirectoryHandle() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("CarouselDB", 1);

      request.onerror = () => resolve(null);

      request.onsuccess = (event) => {
        const db = event.target.result;

        if (!db.objectStoreNames.contains("directoryHandles")) {
          db.close();
          resolve(null);
          return;
        }

        const transaction = db.transaction(["directoryHandles"], "readonly");
        const store = transaction.objectStore("directoryHandles");
        const getRequest = store.get("imagesDirectory");

        getRequest.onsuccess = () => {
          db.close();
          resolve(getRequest.result || null);
        };

        getRequest.onerror = () => {
          db.close();
          resolve(null);
        };
      };
    });
  }

  async clearStoredDirectoryHandle() {
    return new Promise((resolve) => {
      const request = indexedDB.open("CarouselDB", 1);

      request.onerror = () => resolve();

      request.onsuccess = (event) => {
        const db = event.target.result;

        if (!db.objectStoreNames.contains("directoryHandles")) {
          db.close();
          resolve();
          return;
        }

        const transaction = db.transaction(["directoryHandles"], "readwrite");
        const store = transaction.objectStore("directoryHandles");

        store.delete("imagesDirectory");

        transaction.oncomplete = () => {
          db.close();
          resolve();
        };

        transaction.onerror = () => {
          db.close();
          resolve();
        };
      };
    });
  }

  hasDirectoryAccess() {
    // directoryHandle이 있고, 아직 권한 검증을 거치지 않은 상태라면 true
    // 실제 권한 검증은 validateDirectoryAccess()에서 수행
    return this.directoryHandle !== null;
  }

  // 올바른 프로젝트 images 폴더가 선택되었는지 확인
  hasValidProjectImagesFolder() {
    return (
      this.directoryHandle !== null && this.directoryHandle.name === "images"
    );
  }

  // 폴더 변경이 허용되는지 확인 (보안 및 무결성 유지)
  canChangeDirectory() {
    // 올바른 프로젝트 폴더가 이미 선택된 경우 변경 불허
    const hasValidFolder = this.hasValidProjectImagesFolder();

    if (hasValidFolder) {
      console.log(
        "🔒 올바른 프로젝트 images 폴더가 이미 선택되어 변경이 제한됩니다"
      );
      return false;
    }

    return true;
  }

  getDirectoryName() {
    return this.directoryHandle?.name || null;
  }

  // 폴더와 config를 완전히 동기화하는 메서드 (추가 + 제거)
  async syncImagesWithFolder() {
    if (!this.directoryHandle) {
      console.warn("디렉토리 핸들이 없어 이미지 동기화를 할 수 없습니다.");
      return { scanned: 0, added: 0, removed: 0, synced: 0 };
    }

    console.log("=== 이미지 폴더 동기화 시작 ===");
    console.log("동기화 대상 폴더:", this.directoryHandle.name);

    const imageExtensions = ["jpg", "jpeg", "png", "gif", "bmp", "webp", "svg"];

    try {
      // 1단계: 현재 폴더에 실제로 존재하는 이미지 파일들 수집
      const actualFiles = new Set();
      let scannedCount = 0;

      console.log("1단계: 폴더 내 실제 이미지 파일 스캔...");
      for await (const [name, handle] of this.directoryHandle.entries()) {
        if (handle.kind === "file") {
          scannedCount++;
          const extension = name.split(".").pop()?.toLowerCase();
          if (extension && imageExtensions.includes(extension)) {
            actualFiles.add(name.toLowerCase());
            console.log(`실제 파일 발견: ${name}`);
          }
        }
      }

      // 2단계: config에서 실제로 존재하지 않는 파일들 제거
      console.log("2단계: config에서 삭제된 파일들 제거...");
      const originalImages = [...this.config.images];
      let removedCount = 0;

      this.config.images = this.config.images.filter((image) => {
        const exists = actualFiles.has(image.filename.toLowerCase());
        if (!exists) {
          console.log(`config에서 제거: ${image.filename} (폴더에 없음)`);
          removedCount++;
          return false;
        }
        return true;
      });

      // 3단계: 폴더에 있지만 config에 없는 새 파일들 추가
      console.log("3단계: 새로운 파일들 config에 추가...");
      const configFilenames = new Set(
        this.config.images.map((img) => img.filename.toLowerCase())
      );

      let addedCount = 0;
      for await (const [name, handle] of this.directoryHandle.entries()) {
        if (handle.kind === "file") {
          const extension = name.split(".").pop()?.toLowerCase();
          if (extension && imageExtensions.includes(extension)) {
            if (!configFilenames.has(name.toLowerCase())) {
              console.log(`config에 추가: ${name}`);

              const imageData = {
                filename: name,
                path: `images/${name}`,
                alt: name.split(".")[0],
              };

              await this.addExistingImage(imageData, true);
              addedCount++;
            }
          }
        }
      }

      // 4단계: 순서 재정렬
      this.config.images.forEach((img, idx) => {
        img.order = idx + 1;
      });

      // 5단계: 변경사항이 있으면 저장
      if (addedCount > 0 || removedCount > 0) {
        console.log("변경사항 저장 중...");
        this.saveConfig();
      }

      console.log("=== 이미지 폴더 동기화 완료 ===");
      console.log(`스캔한 파일: ${scannedCount}개`);
      console.log(`추가한 이미지: ${addedCount}개`);
      console.log(`제거한 이미지: ${removedCount}개`);
      console.log(`최종 이미지 수: ${this.config.images.length}개`);

      return {
        scanned: scannedCount,
        added: addedCount,
        removed: removedCount,
        synced: this.config.images.length,
      };
    } catch (error) {
      console.error("🚨 이미지 동기화 중 오류:", error);
      return {
        scanned: 0,
        added: 0,
        removed: 0,
        synced: 0,
        error: error.message,
      };
    }
  }

  // 폴더에서 기존 이미지들을 스캔하고 자동으로 추가하는 메서드 (기존 - 추가만)
  async scanExistingImages() {
    if (!this.directoryHandle) {
      console.warn("디렉토리 핸들이 없어 이미지 스캔을 할 수 없습니다.");
      return { scanned: 0, added: 0, skipped: 0 };
    }

    console.log("=== 기존 이미지 스캔 시작 ===");
    console.log("스캔 대상 폴더:", this.directoryHandle.name);

    const imageExtensions = ["jpg", "jpeg", "png", "gif", "bmp", "webp", "svg"];
    const existingFilenames = this.config.images.map((img) =>
      img.filename.toLowerCase()
    );

    let scannedCount = 0;
    let addedCount = 0;
    let skippedCount = 0;

    try {
      // directoryHandle이 이미 images 폴더를 가리키므로 바로 스캔
      console.log("images 폴더에서 이미지 파일 스캔 중...");

      // 폴더 내의 모든 파일 스캔
      for await (const [name, handle] of this.directoryHandle.entries()) {
        if (handle.kind === "file") {
          scannedCount++;

          // 파일 확장자 확인
          const extension = name.split(".").pop()?.toLowerCase();
          if (!extension || !imageExtensions.includes(extension)) {
            console.log(`이미지가 아닌 파일 건너뜀: ${name}`);
            continue;
          }

          // 이미 존재하는 파일인지 확인
          if (existingFilenames.includes(name.toLowerCase())) {
            console.log(`이미 존재하는 이미지 건너뜀: ${name}`);
            skippedCount++;
            continue;
          }

          try {
            console.log(`이미지 추가 중: ${name}`);

            // 이미지 데이터 생성 - 항상 images/ 경로로 통일
            const imageData = {
              filename: name,
              path: `images/${name}`,
              alt: name.split(".")[0],
            };

            // 이미지를 config에 추가 (저장은 하지 않음 - 배치 처리)
            await this.addExistingImage(imageData, true);
            addedCount++;
          } catch (error) {
            console.error(`이미지 추가 실패: ${name}`, error);
          }
        }
      }

      // 스캔 완료 후 한 번만 저장
      if (addedCount > 0) {
        console.log(
          `📁 ${addedCount}개 이미지 추가 완료 - config.json 저장 중...`
        );
        this.saveConfig();
      }

      console.log("=== 이미지 스캔 완료 ===");
      console.log(`스캔한 파일: ${scannedCount}개`);
      console.log(`추가한 이미지: ${addedCount}개`);
      console.log(`건너뛴 이미지: ${skippedCount}개`);

      return {
        scanned: scannedCount,
        added: addedCount,
        skipped: skippedCount,
      };
    } catch (error) {
      console.error("🚨 이미지 스캔 중 오류:", error);
      return {
        scanned: scannedCount,
        added: addedCount,
        skipped: skippedCount,
        error: error.message,
      };
    }
  }

  // 이미 존재하는 이미지를 config에 추가하는 메서드 (파일 복사 없이)
  async addExistingImage(imageData, skipSave = false) {
    const newId = Math.max(0, ...this.config.images.map((img) => img.id)) + 1;

    const newImage = {
      id: newId,
      filename: imageData.filename,
      path: imageData.path,
      order: this.config.images.length + 1,
      enabled: true,
      alt: imageData.alt || imageData.filename.split(".")[0],
      addedDate: new Date().toISOString(),
      fileSize: null, // 기존 파일이므로 크기 정보 없음
      isExisting: true, // 기존 파일임을 표시
      ...imageData,
    };

    this.config.images.push(newImage);

    // skipSave가 true가 아닌 경우에만 저장 (배치 처리 시 사용)
    if (!skipSave) {
      this.saveConfig();
    }

    return newImage;
  }

  // 이미지 캐시 정리 메서드
  clearImageCache() {
    for (const [path, cached] of this.imageCache.entries()) {
      URL.revokeObjectURL(cached.url);
    }
    this.imageCache.clear();
  }

  // 만료된 캐시만 정리
  cleanExpiredCache() {
    const now = Date.now();
    for (const [path, cached] of this.imageCache.entries()) {
      if (now - cached.timestamp > this.imageCacheTimeout) {
        URL.revokeObjectURL(cached.url);
        this.imageCache.delete(path);
      }
    }
  }

  // 완전한 메모리 정리 메서드
  destroy() {
    console.log("🧹 ConfigManager 메모리 정리 시작...");

    // 1. 타이머 정리
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }

    if (this.backupIntervalId) {
      clearInterval(this.backupIntervalId);
      this.backupIntervalId = null;
    }

    if (this.configWatchIntervalId) {
      clearInterval(this.configWatchIntervalId);
      this.configWatchIntervalId = null;
    }

    // 2. 이미지 캐시 정리 (Blob URL 해제)
    this.clearImageCache();

    // 3. 이벤트 리스너 정리
    this.listeners.clear();

    // 4. 핸들 참조 정리
    this.directoryHandle = null;
    this.fileHandle = null;

    // 5. 설정 데이터 정리
    this.config = null;

    console.log("✅ ConfigManager 메모리 정리 완료");
  }

  // config.json 파일 변경 감시 시작
  startConfigFileWatcher() {
    if (!this.directoryHandle) {
      console.log(
        "📁 디렉토리 핸들이 없어 config.json 감시를 시작할 수 없습니다"
      );
      return;
    }

    console.log("👁️ config.json 파일 변경 감시 시작 (1초 간격)");

    this.configWatchIntervalId = setInterval(async () => {
      await this.checkConfigFileChanges();
    }, this.configWatchInterval);
  }

  // config.json 파일 변경 감지 및 자동 리로드
  async checkConfigFileChanges() {
    if (!this.directoryHandle) {
      return;
    }

    try {
      // config.json 파일 핸들 가져오기
      const configFileHandle = await this.directoryHandle.getFileHandle(
        "config.json"
      );
      const configFile = await configFileHandle.getFile();
      const currentModified = configFile.lastModified;

      // 처음 체크하는 경우 현재 시간을 기준으로 설정
      if (this.lastConfigModified === null) {
        this.lastConfigModified = currentModified;
        return;
      }

      // 파일이 변경되었는지 확인
      if (currentModified > this.lastConfigModified) {
        console.log("🔄 config.json 파일 변경 감지! 자동 리로드 중...");
        this.lastConfigModified = currentModified;

        // 설정 리로드
        await this.reloadConfigFromFile(configFile);

        // 변경 알림
        this.notifyListeners("configReloaded", this.config);
        console.log("✅ config.json 자동 리로드 완료");
      }
    } catch (error) {
      if (error.name !== "NotFoundError") {
        console.warn("config.json 파일 감시 중 오류:", error.message);
      }
    }
  }

  // 파일 객체로부터 config 리로드
  async reloadConfigFromFile(configFile) {
    try {
      const configText = await configFile.text();
      const newConfigData = JSON.parse(configText);

      // 기존 config와 비교하여 실제 변경사항이 있는지 확인
      const configChanged =
        JSON.stringify(this.config) !== JSON.stringify(newConfigData);

      if (configChanged) {
        console.log("📋 config.json 내용 변경 감지");
        this.config = newConfigData;
        this.validateConfig();

        // 이미지 목록 변경사항 체크
        const imageCountChanged =
          this.config.images?.length !== this.getImages().length;
        if (imageCountChanged) {
          console.log("🖼️ 이미지 목록 변경 감지");
        }

        return true;
      } else {
        console.log("📄 config.json 파일은 변경되었지만 내용은 동일함");
        return false;
      }
    } catch (error) {
      console.error("config.json 리로드 실패:", error);
      return false;
    }
  }

  // config.json 감시 중지
  stopConfigFileWatcher() {
    if (this.configWatchIntervalId) {
      clearInterval(this.configWatchIntervalId);
      this.configWatchIntervalId = null;
      console.log("⏹️ config.json 파일 감시 중지");
    }
  }
}

// 전역에서 사용할 수 있도록 export
window.ConfigManager = ConfigManager;
