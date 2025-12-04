import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getRoot, $insertNodes, type LexicalNode } from "lexical";
import { useCallback, useEffect, useRef, useState } from "react";
import { $createImageNode, $isImageNode, ImageNode } from "./ImageNode";

export interface TrackedImage {
  src: string;
  fileName?: string;
  altText: string;
  nodeKey: string;
}

declare global {
  interface Window {
    __lexicalImageFileSelect?: () => void;
    __lexicalImageRemove?: (nodeKey: string) => void;
  }
}

interface ImagePluginProps {
  onImagesChange?: (images: TrackedImage[]) => void;
}

export function ImagePlugin({ onImagesChange }: ImagePluginProps) {
  const [editor] = useLexicalComposerContext();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);
  const lastImagesRef = useRef<string>("");

  // Track images in the editor and report changes
  const extractImages = useCallback((): TrackedImage[] => {
    const images: TrackedImage[] = [];
    editor.getEditorState().read(() => {
      const root = $getRoot();
      const walkNode = (node: LexicalNode): void => {
        if ($isImageNode(node)) {
          images.push({
            src: node.getSrc(),
            fileName: node.getFileName(),
            altText: node.getAltText(),
            nodeKey: node.getKey(),
          });
        }
        if ("getChildren" in node && typeof node.getChildren === "function") {
          const children = node.getChildren() as LexicalNode[];
          children.forEach(walkNode);
        }
      };
      const children = root.getChildren();
      children.forEach(walkNode);
    });
    return images;
  }, [editor]);

  // Remove image by node key
  const removeImage = useCallback(
    (nodeKey: string) => {
      editor.update(() => {
        const node = editor.getEditorState()._nodeMap.get(nodeKey);
        if (node && $isImageNode(node)) {
          node.remove();
        }
      });
    },
    [editor]
  );

  // Register update listener to track image changes
  useEffect(() => {
    if (!onImagesChange) return;

    const unregister = editor.registerUpdateListener(() => {
      const images = extractImages();
      const imagesKey = JSON.stringify(images.map((i) => i.nodeKey));

      // Only call onImagesChange if the images actually changed
      if (imagesKey !== lastImagesRef.current) {
        lastImagesRef.current = imagesKey;
        onImagesChange(images);
      }
    });

    // Initial extraction
    const initialImages = extractImages();
    const initialKey = JSON.stringify(initialImages.map((i) => i.nodeKey));
    if (initialKey !== lastImagesRef.current) {
      lastImagesRef.current = initialKey;
      onImagesChange(initialImages);
    }

    return unregister;
  }, [editor, extractImages, onImagesChange]);

  // Expose removeImage globally
  useEffect(() => {
    window.__lexicalImageRemove = removeImage;
    return () => {
      delete window.__lexicalImageRemove;
    };
  }, [removeImage]);

  useEffect(() => {
    if (!editor.hasNodes([ImageNode])) {
      throw new Error("ImagePlugin: ImageNode not registered on editor");
    }

    // Handle paste events for images
    const handlePaste = (event: ClipboardEvent) => {
      const files = event.clipboardData?.files;
      if (!files || files.length === 0) return;

      const imageFiles = Array.from(files).filter((file) =>
        file.type.startsWith("image/")
      );

      if (imageFiles.length === 0) return;

      event.preventDefault();

      // Read files first, then update editor
      Promise.all(
        imageFiles.map((file) => {
          return new Promise<{ src: string; fileName: string }>((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
              const base64 = e.target?.result as string;
              resolve({ src: base64, fileName: file.name });
            };
            reader.readAsDataURL(file);
          });
        })
      ).then((images) => {
        editor.update(() => {
          images.forEach((image) => {
            const imageNode = $createImageNode({
              src: image.src,
              altText: image.fileName,
              fileName: image.fileName,
            });
            $insertNodes([imageNode]);
          });
        });
      });
    };

    // Handle drop events for images
    const handleDrop = (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      
      dragCounter.current = 0;
      setIsDragging(false);

      const files = event.dataTransfer?.files;
      if (!files || files.length === 0) return;

      const imageFiles = Array.from(files).filter((file) =>
        file.type.startsWith("image/")
      );

      if (imageFiles.length === 0) return;

      // Read files first, then update editor
      Promise.all(
        imageFiles.map((file) => {
          return new Promise<{ src: string; fileName: string }>((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
              const base64 = e.target?.result as string;
              resolve({ src: base64, fileName: file.name });
            };
            reader.readAsDataURL(file);
          });
        })
      ).then((images) => {
        editor.update(() => {
          images.forEach((image) => {
            const imageNode = $createImageNode({
              src: image.src,
              altText: image.fileName,
              fileName: image.fileName,
            });
            $insertNodes([imageNode]);
          });
        });
      });
    };

    // Handle dragover to allow drop
    const handleDragOver = (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
    };

    // Handle dragenter to provide visual feedback
    const handleDragEnter = (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      dragCounter.current++;
      
      // Always set dragging to true when files are being dragged
      // We'll filter for images on drop
      setIsDragging(true);
    };

    // Handle dragleave to remove visual feedback
    const handleDragLeave = (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      dragCounter.current--;
      
      if (dragCounter.current === 0) {
        setIsDragging(false);
      }
    };

    const rootElement = editor.getRootElement();
    if (rootElement) {
      rootElement.addEventListener("paste", handlePaste);
      rootElement.addEventListener("drop", handleDrop);
      rootElement.addEventListener("dragover", handleDragOver);
      rootElement.addEventListener("dragenter", handleDragEnter);
      rootElement.addEventListener("dragleave", handleDragLeave);
      
      // Apply visual feedback
      if (isDragging) {
        rootElement.style.backgroundColor = 'rgba(59, 130, 246, 0.1)';
        rootElement.style.outline = '2px dashed rgb(59, 130, 246)';
        rootElement.style.outlineOffset = '-2px';
      } else {
        rootElement.style.backgroundColor = '';
        rootElement.style.outline = '';
        rootElement.style.outlineOffset = '';
      }
    }

    return () => {
      if (rootElement) {
        rootElement.removeEventListener("paste", handlePaste);
        rootElement.removeEventListener("drop", handleDrop);
        rootElement.removeEventListener("dragover", handleDragOver);
        rootElement.removeEventListener("dragenter", handleDragEnter);
        rootElement.removeEventListener("dragleave", handleDragLeave);
        // Clean up styles
        rootElement.style.backgroundColor = '';
        rootElement.style.outline = '';
        rootElement.style.outlineOffset = '';
      }
    };
  }, [editor, isDragging]);

  // Function to trigger file selection
  const handleFileSelect = () => {
    inputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const imageFiles = Array.from(files).filter((file) =>
      file.type.startsWith("image/")
    );

    // Read files first, then update editor
    Promise.all(
      imageFiles.map((file) => {
        return new Promise<{ src: string; fileName: string }>((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            const base64 = e.target?.result as string;
            resolve({ src: base64, fileName: file.name });
          };
          reader.readAsDataURL(file);
        });
      })
    ).then((images) => {
      editor.update(() => {
        images.forEach((image) => {
          const imageNode = $createImageNode({
            src: image.src,
            altText: image.fileName,
            fileName: image.fileName,
          });
          $insertNodes([imageNode]);
        });
      });
    });

    // Reset input
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  // Expose the file select handler globally
  useEffect(() => {
    const handleGlobalFileSelect = () => {
      handleFileSelect();
    };
    
    window.__lexicalImageFileSelect = handleGlobalFileSelect;
    
    return () => {
      delete window.__lexicalImageFileSelect;
    };
  }, []);

  return (
    <input
      ref={inputRef}
      type="file"
      accept="image/*"
      multiple
      onChange={handleFileChange}
      style={{ display: "none" }}
    />
  );
}
