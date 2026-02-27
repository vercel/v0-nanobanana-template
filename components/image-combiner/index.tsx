"use client"
import { useRouter } from "next/navigation"
import dynamic from "next/dynamic"
import type { ReactElement } from "react"
import { useState, useEffect, useRef, useCallback, memo, lazy, Suspense } from "react"
import { useIsMobile } from "@/hooks/use-mobile"
import { useImageUpload } from "./hooks/use-image-upload"
import { useImageGeneration } from "./hooks/use-image-generation"
import { useAspectRatio } from "./hooks/use-aspect-ratio"
import { useImageActions } from "./hooks/use-image-actions"
import { useKeyboardShortcuts } from "./hooks/use-keyboard-shortcuts"
import { useDragDrop } from "./hooks/use-drag-drop"
import { usePasteHandler } from "./hooks/use-paste-handler"
import { useResizablePanels } from "./hooks/use-resizable-panels"
import { usePersistentHistory } from "./hooks/use-persistent-history"
import { useAuth } from "@/hooks/use-auth"
import { useUsage } from "@/hooks/use-usage"
import { useInit } from "@/hooks/use-init"
import { AuthButton } from "../auth-button"
import { InputSection } from "./input-section"
import { OutputSection } from "./output-section"
import { ToastNotification } from "./toast-notification"
import { GenerationHistory } from "./generation-history"
import { GlobalDropZone } from "./global-drop-zone"
import { SetupBanner } from "../setup-banner"
import { savePendingGeneration, getPendingGeneration, clearPendingGeneration } from "@/lib/generation-state"
import type { AspectRatio } from "@/types"
import type { ModelType, ThinkingLevel, Resolution } from "./types"
import { useDraftState, getSavedDraft, clearDraft } from "./hooks/use-draft-state"

// Dithering shader — imported directly for instant render (no lazy flash)
const Dithering = dynamic(
  () => import("@paper-design/shaders-react").then((mod) => ({ default: mod.Dithering })),
  { ssr: false, loading: () => <div className="w-full h-full bg-black" /> }
)
const MemoizedDithering = memo(Dithering)

// Modals are only shown on user interaction - no need to load them upfront
const AuthRequiredModal = lazy(() => import("../auth-required-modal").then((mod) => ({ default: mod.AuthRequiredModal })))
const HowItWorksModal = lazy(() => import("./how-it-works-modal").then((mod) => ({ default: mod.HowItWorksModal })))
const FullscreenViewer = lazy(() => import("./fullscreen-viewer").then((mod) => ({ default: mod.FullscreenViewer })))

export function ImageCombiner(): ReactElement {
  const isMobile = useIsMobile()
  const { isAuthenticated, loading: authLoading } = useAuth()
  const router = useRouter()
  const { remaining, decrementOptimistic, loading: usageLoading } = useUsage()
  const { data: initData } = useInit()

  // UI State — restore from draft if available
  const [prompt, setPrompt] = useState("")
  const [useUrls, setUseUrls] = useState(false)
  const [selectedModel, setSelectedModel] = useState<ModelType>("nb2")
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>("minimal")
  const [resolution, setResolution] = useState<Resolution>("1K")
  const [useGrounding, setUseGrounding] = useState(false)
  const draftRef = useRef<ReturnType<typeof getSavedDraft>>(null)
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null)
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [showHowItWorks, setShowHowItWorks] = useState(false)
  const [logoLoaded, setLogoLoaded] = useState(false)

  const promptTextareaRef = useRef<HTMLTextAreaElement>(null)

  const showToast = useCallback((message: string, type: "success" | "error" = "success") => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }, [])

  // Aspect Ratio
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("square")
  const { availableAspectRatios, detectAspectRatio } = useAspectRatio()

  // Image Upload
  const {
    image1,
    image1Preview,
    image1Url,
    image2,
    image2Preview,
    image2Url,
    handleImageUpload,
    handleUrlChange,
    clearImage,
    restoreImageFromDataUrl,
    showToast: uploadShowToast,
  } = useImageUpload({
    onImageLoaded: (width, height, imageNumber) => {
      const detectedRatio = detectAspectRatio(width, height)
      setAspectRatio(detectedRatio)
    },
  })

  // Restore draft on mount (client-only, avoids SSR mismatch)
  const draftRestored = useRef(false)
  useEffect(() => {
    if (draftRestored.current) return
    draftRestored.current = true
    const draft = getSavedDraft()
    draftRef.current = draft
    if (!draft) return
    if (draft.prompt) setPrompt(draft.prompt)
    if (draft.aspectRatio) setAspectRatio(draft.aspectRatio as AspectRatio)
    if (draft.selectedModel) setSelectedModel(draft.selectedModel)
    if (draft.thinkingLevel) setThinkingLevel(draft.thinkingLevel)
    if (draft.resolution) setResolution(draft.resolution)
    if (draft.useGrounding) setUseGrounding(draft.useGrounding)
    if (draft.useUrls) {
      setUseUrls(true)
      if (draft.image1Url) handleUrlChange(draft.image1Url, 1)
      if (draft.image2Url) handleUrlChange(draft.image2Url, 2)
    } else {
      if (draft.image1Preview) restoreImageFromDataUrl(draft.image1Preview, 1)
      if (draft.image2Preview) restoreImageFromDataUrl(draft.image2Preview, 2)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-save draft on changes
  useDraftState({
    prompt,
    aspectRatio,
    selectedModel,
    thinkingLevel,
    resolution,
    useGrounding,
    useUrls,
    image1Url,
    image2Url,
    image1Preview,
    image2Preview,
  })

  // Persistent History
  const {
    generations: persistedGenerations,
    setGenerations: setPersistedGenerations,
    addGeneration,
    clearHistory,
    deleteGeneration,
    isLoading: historyLoading,
    hasInitiallyLoaded,
    hasMore,
    loadMore,
    isLoadingMore,
  } = usePersistentHistory(showToast)

  // Image Generation
  const {
    selectedGenerationId,
    setSelectedGenerationId,
    imageLoaded,
    setImageLoaded,
    generateImage: runGeneration,
    cancelGeneration,
    loadGeneratedAsInput,
    markGenerationComplete,
  } = useImageGeneration({
    prompt,
    aspectRatio,
    image1,
    image2,
    image1Url,
    image2Url,
    useUrls,
    selectedModel,
    thinkingLevel,
    resolution,
    useGrounding,
    generations: persistedGenerations,
    setGenerations: setPersistedGenerations,
    addGeneration,
    onToast: showToast,
    onImageUpload: handleImageUpload,

  })

  // Derived state
  const selectedGeneration = persistedGenerations.find((g) => g.id === selectedGenerationId) || persistedGenerations[0]
  const isLoading = persistedGenerations.some((g) => g.status === "loading")
  const generatedImage =
    selectedGeneration?.status === "complete" && selectedGeneration.imageUrl
      ? { url: selectedGeneration.imageUrl, prompt: selectedGeneration.prompt }
      : null
  const hasImages = useUrls ? image1Url || image2Url : image1 || image2
  const currentMode = hasImages ? "image-editing" : "text-to-image"
  const canGenerate = prompt.trim().length > 0 && (currentMode === "text-to-image" || (useUrls ? image1Url : image1))

  // Image Actions (fullscreen, download, copy, etc.)
  const {
    showFullscreen,
    fullscreenImageUrl,
    setFullscreenImageUrl,
    openFullscreen,
    closeFullscreen,
    downloadImage,
    openImageInNewTab,
    copyImageToClipboard,
  } = useImageActions({
    isMobile: isMobile || false,
    currentMode,
    onToast: showToast,
  })

  // Resizable Panels
  const { leftWidth, hasResized, containerRef, handleMouseDown, handleDoubleClick } = useResizablePanels()

  // Drag & Drop
  const { isDraggingOver, dropZoneHover, setDropZoneHover, handleGlobalDrop } = useDragDrop({
    onImageUpload: handleImageUpload,
    setUseUrls,
    onToast: showToast,
  })

  // Paste Handler
  const { handlePromptPaste } = usePasteHandler({
    image1,
    image2,
    image1Url,
    image2Url,
    useUrls,
    setUseUrls,
    onImageUpload: handleImageUpload,
    onUrlChange: handleUrlChange,
    onToast: showToast,
  })

  // Auth modal handler
  const handleShowAuthModal = useCallback(() => {
    const currentPrompt = promptTextareaRef.current?.value || prompt

    savePendingGeneration({
      prompt: currentPrompt,
      aspectRatio,
      image1Url,
      image2Url,
      image1Preview,
      image2Preview,
      useUrls,
      useProModel: selectedModel === "pro",
      selectedModel,
      thinkingLevel,
      resolution,
      useGrounding,
      timestamp: Date.now(),
    })

    setShowAuthModal(true)
  }, [prompt, aspectRatio, image1Url, image2Url, image1Preview, image2Preview, useUrls, selectedModel, thinkingLevel, resolution, useGrounding])

  const savePendingAndGenerate = useCallback(() => {
    const currentPrompt = promptTextareaRef.current?.value || prompt

    savePendingGeneration({
      prompt: currentPrompt,
      aspectRatio,
      image1Url,
      image2Url,
      image1Preview,
      image2Preview,
      useUrls,
      useProModel: selectedModel === "pro",
      selectedModel,
      thinkingLevel,
      resolution,
      useGrounding,
      timestamp: Date.now(),
    })

    runGeneration()
  }, [prompt, aspectRatio, image1Url, image2Url, image1Preview, image2Preview, useUrls, selectedModel, thinkingLevel, resolution, useGrounding, runGeneration])

  // Keyboard Shortcuts
  const { handleKeyDown } = useKeyboardShortcuts({
    canGenerate,
    isAuthenticated,
    remaining,
    showFullscreen,
    fullscreenImageUrl,
    generatedImage,
    persistedGenerations,
    onGenerate: runGeneration,
    onShowAuthModal: handleShowAuthModal,
    decrementOptimistic,
    savePendingAndGenerate, // Pass new function
    onCopyImage: () => copyImageToClipboard(generatedImage),
    onDownloadImage: () => downloadImage(generatedImage),
    onLoadAsInput: loadGeneratedAsInput,
    onCloseFullscreen: closeFullscreen,
    setFullscreenImageUrl,
    setSelectedGenerationId,
  })

  // Auto-select first generation on load
  useEffect(() => {
    if (!historyLoading && persistedGenerations.length > 0 && !selectedGenerationId) {
      const firstCompleted = persistedGenerations.find((g) => g.status === "complete")
      if (firstCompleted) {
        setSelectedGenerationId(firstCompleted.id)
      }
    }
  }, [historyLoading, persistedGenerations, selectedGenerationId, setSelectedGenerationId])

  // Keep imageLoaded in sync — no fade transition on selection change
  useEffect(() => {
    if (selectedGeneration?.status === "complete" && selectedGeneration?.imageUrl) {
      setImageLoaded(true)
    }
  }, [selectedGenerationId, selectedGeneration?.imageUrl, setImageLoaded])

  // Initialize upload toast ref
  useEffect(() => {
    uploadShowToast.current = showToast
  }, [showToast])

  // Pending generation restoration after login
  const [shouldGenerateAfterRestore, setShouldGenerateAfterRestore] = useState(false)
  const pendingGenerationData = useRef<{
    prompt: string
    aspectRatio: AspectRatio
    selectedModel: ModelType
    thinkingLevel: ThinkingLevel
    resolution: Resolution
    useGrounding: boolean
    image1?: File | null
    image2?: File | null
    image1Url?: string
    image2Url?: string
    useUrls: boolean
  } | null>(null)
  const restorationAttempted = useRef(false)

  useEffect(() => {
    if (restorationAttempted.current) {
      return
    }
    if (authLoading) {
      return
    }
    if (!isAuthenticated) {
      return
    }

    const pending = getPendingGeneration()
    if (!pending) {
      return
    }

    restorationAttempted.current = true

    setPrompt(pending.prompt)
    setAspectRatio(pending.aspectRatio as AspectRatio)
    setUseUrls(pending.useUrls)
    setSelectedModel(pending.selectedModel || (pending.useProModel ? "pro" : "classic"))
    setThinkingLevel(pending.thinkingLevel || "minimal")
    setResolution(pending.resolution || "1K")
    setUseGrounding(pending.useGrounding ?? true)

    clearPendingGeneration()

    if (pending.useUrls) {
      if (pending.image1Url) {
        handleUrlChange(pending.image1Url, 1)
      }
      if (pending.image2Url) {
        handleUrlChange(pending.image2Url, 2)
      }

      pendingGenerationData.current = {
        prompt: pending.prompt,
        aspectRatio: pending.aspectRatio as AspectRatio,
        selectedModel: pending.selectedModel || (pending.useProModel ? "pro" : "classic"),
        thinkingLevel: pending.thinkingLevel || "minimal",
        resolution: pending.resolution || "1K",
        useGrounding: pending.useGrounding ?? true,
        image1Url: pending.image1Url,
        image2Url: pending.image2Url,
        useUrls: true,
      }

      setShouldGenerateAfterRestore(true)
      return
    }

    const convertDataUrlToFile = async (dataUrl: string, name: string): Promise<File> => {
      const response = await fetch(dataUrl)
      const blob = await response.blob()
      return new File([blob], name, { type: blob.type || "image/png" })
    }

    const restoreFiles = async () => {
      let restoredImage1: File | null = null
      let restoredImage2: File | null = null

      if (pending.image1Preview) {
        restoredImage1 = await convertDataUrlToFile(pending.image1Preview, "restored-image-1.png")
        restoreImageFromDataUrl(pending.image1Preview, 1)
      }

      if (pending.image2Preview) {
        restoredImage2 = await convertDataUrlToFile(pending.image2Preview, "restored-image-2.png")
        restoreImageFromDataUrl(pending.image2Preview, 2)
      }

      pendingGenerationData.current = {
        prompt: pending.prompt,
        aspectRatio: pending.aspectRatio as AspectRatio,
        selectedModel: pending.selectedModel || (pending.useProModel ? "pro" : "classic"),
        thinkingLevel: pending.thinkingLevel || "minimal",
        resolution: pending.resolution || "1K",
        useGrounding: pending.useGrounding ?? true,
        image1: restoredImage1,
        image2: restoredImage2,
        useUrls: false,
      }

      setShouldGenerateAfterRestore(true)
    }

    restoreFiles().catch((error) => {
      console.error("Error restoring images:", error)
      showToast("Error restoring images", "error")
    })
  }, [isAuthenticated, authLoading, restoreImageFromDataUrl, handleUrlChange, showToast])

  useEffect(() => {
    if (!shouldGenerateAfterRestore || !pendingGenerationData.current) {
      return
    }

    const data = pendingGenerationData.current

    setShouldGenerateAfterRestore(false)
    pendingGenerationData.current = null

    runGeneration({
      prompt: data.prompt,
      aspectRatio: data.aspectRatio,
      selectedModel: data.selectedModel,
      thinkingLevel: data.thinkingLevel,
      resolution: data.resolution,
      useGrounding: data.useGrounding,
      image1: data.image1,
      image2: data.image2,
      image1Url: data.image1Url,
      image2Url: data.image2Url,
      useUrls: data.useUrls,
    })
  }, [shouldGenerateAfterRestore, runGeneration])

  const clearAll = useCallback(() => {
    setPrompt("")
    clearImage(1)
    clearImage(2)
    clearDraft()
    setTimeout(() => {
      promptTextareaRef.current?.focus()
    }, 0)
  }, [clearImage])

  const handleFullscreenNavigate = useCallback(
    (direction: "prev" | "next") => {
      const completedGenerations = (persistedGenerations ?? []).filter((g) => g.status === "complete" && g.imageUrl)
      const currentIndex = completedGenerations.findIndex((g) => g.imageUrl === fullscreenImageUrl)
      if (currentIndex === -1) return

      let newIndex: number
      if (direction === "prev") {
        newIndex = currentIndex === 0 ? completedGenerations.length - 1 : currentIndex - 1
      } else {
        newIndex = currentIndex === completedGenerations.length - 1 ? 0 : currentIndex + 1
      }

      setFullscreenImageUrl(completedGenerations[newIndex].imageUrl!)
      setSelectedGenerationId(completedGenerations[newIndex].id)
    },
    [persistedGenerations, fullscreenImageUrl, setFullscreenImageUrl, setSelectedGenerationId],
  )

  return (
    <div className="bg-background min-h-screen flex items-center justify-center select-none font-[family-name:var(--font-geist-pixel)]">
      {/* JSON-LD structured data is in layout.tsx - single source of truth for SEO */}

      {toast && <ToastNotification message={toast.message} type={toast.type} />}

      {isDraggingOver && (
        <GlobalDropZone dropZoneHover={dropZoneHover} onSetDropZoneHover={setDropZoneHover} onDrop={handleGlobalDrop} />
      )}

      <div className="fixed inset-0 z-0 select-none shader-background bg-black">
        <MemoizedDithering
          colorBack="#00000000"
          colorFront="#2D1B4E"
          speed={0.43}
          shape="wave"
          type="4x4"
          pxSize={3}
          scale={1.13}
          style={{
            backgroundColor: "#000000",
            height: "100vh",
            width: "100vw",
          }}
        />
      </div>

      <div className="relative z-10 w-full h-full flex items-center justify-center p-2 md:p-4">
        <div className="w-full max-w-[98vw] lg:max-w-[96vw] 2xl:max-w-[94vw]">
          <div className="w-full mx-auto select-none">
            <div className="bg-black/70 border-0 px-3 py-3 md:px-4 md:py-4 lg:px-6 lg:py-6 flex flex-col rounded-lg">
              <div className="flex items-start justify-between gap-4 mb-2 md:mb-3 flex-shrink-0">
                <div className="flex flex-col items-start">
                  <h1 className="text-lg md:text-2xl font-bold text-white select-none leading-none">
                    <span className="text-gray-400">v0</span> Nano Banana Playground
                  </h1>
                  <p className="text-[9px] md:text-[10px] text-gray-400 select-none tracking-wide mt-0.5 md:mt-1">
                    Powered by{" "}
                    <a
                      href="https://vercel.com/ai-gateway"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-gray-300 transition-colors"
                    >
                      AI Gateway
                    </a>
                  </p>
                </div>
                <div className="flex flex-col items-end">
                  <AuthButton />
                </div>
              </div>

              {initData && (
                <SetupBanner
                  authConfigured={initData.authConfigured}
                  aiConfigured={initData.aiConfigured}
                  dbConfigured={initData.dbConfigured}
                  blobConfigured={initData.blobConfigured}
                />
              )}

              <div className="flex flex-col gap-4 xl:gap-0">
                <div
                  ref={containerRef}
                  className="flex flex-col xl:flex-row gap-4 xl:gap-0 xl:min-h-[60vh] 2xl:min-h-[62vh]"
                >
                  <div
                    className="flex flex-col xl:w-[45%] xl:min-w-0 xl:pl-4 xl:pr-4 xl:border-r xl:border-white/10 xl:pt-5 flex-shrink-0 xl:overflow-y-auto xl:overflow-x-hidden xl:max-h-[85vh] 2xl:max-h-[80vh]"
                    style={hasResized ? { width: `${leftWidth}%` } : undefined}
                  >
                    <InputSection
                      prompt={prompt}
                      setPrompt={setPrompt}
                      aspectRatio={aspectRatio}
                      setAspectRatio={setAspectRatio}
                      availableAspectRatios={availableAspectRatios}
                      useUrls={useUrls}
                      setUseUrls={setUseUrls}
                      image1Preview={image1Preview}
                      image2Preview={image2Preview}
                      image1Url={image1Url}
                      image2Url={image2Url}
                      canGenerate={canGenerate}
                      hasImages={hasImages}
                      onGenerate={runGeneration}
                      onClearAll={clearAll}
                      onImageUpload={handleImageUpload}
                      onUrlChange={handleUrlChange}
                      onClearImage={clearImage}
                      onKeyDown={handleKeyDown}
                      onPromptPaste={handlePromptPaste}
                      onImageFullscreen={(url) => openFullscreen(url)}
                      promptTextareaRef={promptTextareaRef}
                      isAuthenticated={isAuthenticated}
                      remaining={remaining}
                      decrementOptimistic={decrementOptimistic}
                      usageLoading={usageLoading}
                      generations={persistedGenerations}
                      selectedGenerationId={selectedGenerationId}
                      onSelectGeneration={setSelectedGenerationId}
                      onCancelGeneration={cancelGeneration}
                      onDeleteGeneration={deleteGeneration}
                      historyLoading={historyLoading}
                      hasMore={hasMore}
                      onLoadMore={loadMore}
                      isLoadingMore={isLoadingMore}
                      onShowAuthModal={handleShowAuthModal}
                      savePendingAndGenerate={savePendingAndGenerate}
                      selectedModel={selectedModel}
                      setSelectedModel={setSelectedModel}
                      thinkingLevel={thinkingLevel}
                      setThinkingLevel={setThinkingLevel}
                      resolution={resolution}
                      setResolution={setResolution}
                      useGrounding={useGrounding}
                      setUseGrounding={setUseGrounding}
                    />

                    {/* Desktop History */}
                    <div className="hidden xl:block mt-3 flex-shrink-0">
                      <GenerationHistory
                        generations={persistedGenerations}
                        selectedId={selectedGenerationId}
                        onSelect={setSelectedGenerationId}
                        onCancel={cancelGeneration}
                        onDelete={deleteGeneration}
                        onImageReady={markGenerationComplete}
                        isLoading={historyLoading}
                        hasInitiallyLoaded={hasInitiallyLoaded}
                        hasMore={hasMore}
                        onLoadMore={loadMore}
                        isLoadingMore={isLoadingMore}
                      />
                    </div>
                  </div>

                  <div
                    className="hidden xl:flex items-center justify-center cursor-col-resize hover:bg-white/10 transition-colors relative group"
                    style={{ width: "8px", flexShrink: 0 }}
                    onMouseDown={handleMouseDown}
                    onDoubleClick={handleDoubleClick}
                  >
                    <div className="w-0.5 h-8 bg-white/20 group-hover:bg-white/40 transition-colors rounded-full" />
                  </div>

                  <div
                    className="flex flex-col xl:w-[calc(55%-8px)] xl:pl-4 xl:pr-4 h-[400px] sm:h-[500px] md:h-[600px] xl:h-auto flex-shrink-0"
                    style={hasResized ? { width: `${100 - leftWidth}%` } : undefined}
                  >
                    <OutputSection
                      selectedGeneration={selectedGeneration}
                      generations={persistedGenerations}
                      selectedGenerationId={selectedGenerationId}
                      setSelectedGenerationId={setSelectedGenerationId}
                      imageLoaded={imageLoaded}
                      setImageLoaded={setImageLoaded}
                      onCancelGeneration={cancelGeneration}
                      onDeleteGeneration={deleteGeneration}
                      onOpenFullscreen={() => generatedImage && openFullscreen(generatedImage.url)}
                      onLoadAsInput={loadGeneratedAsInput}
                      onCopy={() => copyImageToClipboard(generatedImage)}
                      onDownload={() => downloadImage(generatedImage)}
                      onOpenInNewTab={() => openImageInNewTab(generatedImage)}
                      onImageReady={markGenerationComplete}
                    />
                  </div>
                </div>

                {/* Mobile History - After both sections */}
                <div className="xl:hidden flex-shrink-0">
                  <GenerationHistory
                    generations={persistedGenerations}
                    selectedId={selectedGenerationId}
                    onSelect={setSelectedGenerationId}
                    onCancel={cancelGeneration}
                    onDelete={deleteGeneration}
                    onImageReady={markGenerationComplete}
                    isLoading={historyLoading}
                    hasMore={hasMore}
                    onLoadMore={loadMore}
                    isLoadingMore={isLoadingMore}
                  />
                </div>
              </div>

              <div className="mt-3 md:mt-4 border-t border-white/10 pt-3 md:pt-5 flex items-center justify-center gap-2 sm:gap-4 text-[10px] sm:text-xs text-white/60 flex-shrink-0">
                <button onClick={() => setShowHowItWorks(true)} className="hover:text-white/80 transition-colors">
                  How it works
                </button>
                <span className="text-white/20">•</span>
                <a
                  href="https://x.com/estebansuarez"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-white/80 transition-colors"
                >
                  @estebansuarez
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Lazy-loaded modals - only loaded when opened */}
      <Suspense fallback={null}>
        {showAuthModal && <AuthRequiredModal open={showAuthModal} onOpenChange={setShowAuthModal} />}
        {showHowItWorks && <HowItWorksModal open={showHowItWorks} onOpenChange={setShowHowItWorks} />}
        {showFullscreen && fullscreenImageUrl && (
          <FullscreenViewer
            imageUrl={fullscreenImageUrl}
            onClose={closeFullscreen}
            onNavigate={handleFullscreenNavigate}
            canNavigate={(persistedGenerations ?? []).filter((g) => g.status === "complete" && g.imageUrl).length > 1}
          />
        )}
      </Suspense>
    </div>
  )
}
