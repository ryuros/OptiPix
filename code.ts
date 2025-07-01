// 이 파일은 "ui.html"에 HTML 페이지를 표시합니다.
figma.showUI(__html__, { themeColors: true, width: 300, height: 150 }); // 플러그인 창 초기 크기 설정

// 바이트 단위를 읽기 쉬운 형태로 변환하는 함수 (KB, MB 등)
function formatBytes(bytes: number, decimals = 2): string {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// 이미지 속성을 가진 노드의 타입을 정의 (width, height, fills 속성을 필수로 가짐)
type ImageCapableNode = SceneNode & { width: number; height: number; fills: Paint[] };

// 고유한 이미지 데이터를 저장할 타입 정의 (노드 + 이미지 해시)
interface UniqueImageData {
    nodeId: string;
    nodeName: string;
    imageHash: string; // 이미지의 고유 해시
    imageBytes?: Uint8Array; // UI로 전송할 실제 바이트
    width: number;
    height: number;
    fileType: string;
    url?: string; // 썸네일 URL
}

/**
 * 선택된 모든 이미지 노드에서 데이터를 추출하여 UI로 일괄 전송합니다.
 * @param uniqueImageCandidates 고유한 이미지 노드 후보 배열 (getUniqueImageCandidates에서 파싱된 결과)
 */
async function sendAllImageDataToUI(uniqueImageCandidates: UniqueImageData[]): Promise<void> {
    const imagesDataForUI = [];

    for (const candidate of uniqueImageCandidates) {
        if (candidate.imageBytes && candidate.url) {
            imagesDataForUI.push({
                nodeId: candidate.nodeId,
                name: candidate.nodeName,
                imageBytes: candidate.imageBytes.buffer,
                width: candidate.width,
                height: candidate.height,
                fileType: candidate.fileType,
                url: candidate.url,
                imageHash: candidate.imageHash
            });
            continue;
        }

        const image = figma.getImageByHash(candidate.imageHash);
        if (image) {
            try {
                const bytes = await image.getBytesAsync();
                const imageURL = await figma.base64Encode(bytes);

                imagesDataForUI.push({
                    nodeId: candidate.nodeId,
                    name: candidate.nodeName,
                    imageBytes: bytes.buffer,
                    width: candidate.width,
                    height: candidate.height,
                    fileType: candidate.fileType,
                    url: `data:image/png;base64,${imageURL}`,
                    imageHash: candidate.imageHash
                });
            } catch (e: any) {
                console.error(`[code.ts] 이미지 "${candidate.nodeName}" (Hash: ${candidate.imageHash}) 로드 중 오류 발생:`, e);
            }
        }
    }
    figma.ui.postMessage({ type: 'selection-image-data-batch', imagesData: imagesDataForUI });
}

// 선택된 노드에서 고유한 이미지 해시를 가진 이미지 노드 정보를 추출하는 헬퍼 함수
function getUniqueImageCandidates(selection: readonly SceneNode[]): UniqueImageData[] {
    const uniqueImageMap = new Map<string, UniqueImageData>(); // Key: nodeId_imageHash
    
    for (const node of selection) {
        if ('fills' in node && Array.isArray(node.fills) && 'width' in node && 'height' in node) {
            const imageFills = (node.fills as Paint[]).filter((fill): fill is ImagePaint => fill.type === 'IMAGE' && fill.imageHash !== null);

            for (const fill of imageFills) {
                const uniqueKey = `${node.id}_${fill.imageHash}`; 
                
                if (!uniqueImageMap.has(uniqueKey)) {
                    uniqueImageMap.set(uniqueKey, {
                        nodeId: node.id,
                        nodeName: node.name,
                        imageHash: fill.imageHash as string,
                        width: node.width,
                        height: node.height,
                        fileType: 'PNG'
                    });
                }
            }
        }
    }
    return Array.from(uniqueImageMap.values());
}

// ★★★ 변경: selectionchange 이벤트 디바운스 로직 강화 ★★★
let selectionChangeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_DELAY_MS = 200; // 딜레이를 200ms로 늘려 안정성 강화

async function handleSelectionChange() {
    console.log('[code.ts] selectionchange 이벤트 디바운스 후 실행.');
    const uniqueImageCandidates = getUniqueImageCandidates(figma.currentPage.selection);
    figma.ui.postMessage({ type: 'selection-change', selectedNodeCount: uniqueImageCandidates.length });
    
    if (uniqueImageCandidates.length > 0) {
        await sendAllImageDataToUI(uniqueImageCandidates);
    } else {
        figma.ui.postMessage({ type: 'selection-image-data-batch', imagesData: [] });
    }
    selectionChangeDebounceTimer = null;
}

figma.on('selectionchange', () => {
    console.log('[code.ts] selectionchange 이벤트 발생 (디바운스 시작).');
    if (selectionChangeDebounceTimer) {
        clearTimeout(selectionChangeDebounceTimer);
    }
    selectionChangeDebounceTimer = setTimeout(handleSelectionChange, DEBOUNCE_DELAY_MS);
});


let totalImagesToProcess = 0;
let processedImageCount = 0;

figma.ui.onmessage = async (msg: { type: string; [key: string]: any }) => {
    console.log(`[code.ts] UI로부터 메시지 수신 - Type: ${msg.type}`);

    if (msg.type === 'resize-ui') {
        const { width, height } = msg;
        const minHeight = 100;
        const adjustedHeight = Math.max(minHeight, height);
        figma.ui.resize(width, adjustedHeight);
    }
    
    else if (msg.type === 'request-all-image-data') {
        // UI가 데이터를 요청하면, 선택된 노드 정보를 가져와서 UI로 보냅니다.
        const uniqueImageCandidates = getUniqueImageCandidates(figma.currentPage.selection);
        if (uniqueImageCandidates.length > 0) {
            await sendAllImageDataToUI(uniqueImageCandidates);
        } else {
            figma.ui.postMessage({ type: 'selection-image-data-batch', imagesData: [] });
        }
    }

    else if (msg.type === 'optimize-images') {
        const { resizePercentage, quality, fileFormats } = msg;
        const imagesToProcessCandidates = getUniqueImageCandidates(figma.currentPage.selection);

        if (imagesToProcessCandidates.length === 0) {
            figma.notify('선택된 레이어에 이미지가 없습니다. 이미지로 채워진 레이어를 선택해주세요.', { error: true });
            return;
        }

        figma.notify(`이미지 ${imagesToProcessCandidates.length}개 최적화 중...`, { timeout: 3000 });
        totalImagesToProcess = imagesToProcessCandidates.length;
        processedImageCount = 0;

        for (const candidate of imagesToProcessCandidates) {
            const image = figma.getImageByHash(candidate.imageHash);
            
            if (image) {
                try {
                    const bytes = await image.getBytesAsync();
                    figma.ui.postMessage({
                        type: 'process-image-data',
                        imageNodeId: candidate.nodeId,
                        imageBytes: bytes,
                        resizePercentage: resizePercentage,
                        quality: quality,
                        width: candidate.width,
                        height: candidate.height,
                        fileType: fileFormats[0]
                    });
                } catch (e: any) {
                    figma.notify(`오류: 이미지 "${candidate.nodeName}" (Hash: ${candidate.imageHash}) 로드 중 오류 발생:`, { error: true });
                }
            }
        }
    }

    else if (msg.type === 'image-optimization-complete') {
        const { imageNodeId, optimizedBytes, originalSize } = msg;
        const node = await figma.getNodeByIdAsync(imageNodeId);

        if (node && 'fills' in node && Array.isArray(node.fills) &&
            (node.type === 'RECTANGLE' || node.type === 'ELLIPSE' || node.type === 'POLYGON' || node.type === 'STAR' || node.type === 'VECTOR' || node.type === 'TEXT')
        ) {
            try {
                const newImageHash = figma.createImage(new Uint8Array(optimizedBytes)).hash;
                const newFills: Paint[] = [];
                for (const fill of node.fills) {
                    if (fill.type === 'IMAGE') {
                        const candidates = getUniqueImageCandidates([node as ImageCapableNode]);
                        const originalCandidate = candidates.find(c => c.nodeId === imageNodeId && c.imageHash === fill.imageHash);

                        if (originalCandidate) {
                             newFills.push({ ...fill, imageHash: newImageHash });
                        } else {
                            newFills.push(fill);
                        }
                    } else {
                        newFills.push(fill);
                    }
                }
                (node as RectangleNode | EllipseNode | PolygonNode | StarNode | TextNode | VectorNode).fills = newFills;

                processedImageCount++;
                if (processedImageCount === totalImagesToProcess) {
                    figma.notify('이미지 최적화가 완료되었습니다!');
                    totalImagesToProcess = 0;
                    processedImageCount = 0;
                }

            } catch (error: any) {
                figma.notify(`오류: 이미지 "${node.name || imageNodeId}" 업데이트에 실패했습니다.`, { error: true });
            }
        } else {
            figma.notify(`오류: 최적화된 이미지를 적용할 노드를 찾을 수 없습니다.`, { error: true });
        }
    }

    else if (msg.type === 'image-optimization-failed') {
        const { imageNodeId, error } = msg;
        figma.notify(`오류: 이미지 ${imageNodeId} 처리 중 문제가 발생했습니다: ${error}`, { error: true });
    }

    else if (msg.type === 'image-export-complete-from-ui') {
        const { optimizedImages, fileName, exportSize, imageNodeId } = msg;
        for (const { format, bytes, originalSize } of optimizedImages) {
            const downloadFormat = format.toLowerCase();
            const downloadFileName = `${fileName}_${exportSize}.${downloadFormat}`;
            figma.ui.postMessage({
                type: 'trigger-download',
                bytes: new Uint8Array(bytes),
                fileName: downloadFileName,
                originalSize: originalSize,
                optimizedSize: bytes.byteLength
            });
        }
    }
    else if (msg.type === 'external-export-complete') {
        const { fileName, originalSize, optimizedSize } = msg;
        figma.notify(`내보내기 완료: ${fileName} (${formatBytes(originalSize)} → ${formatBytes(optimizedSize)})`);
    } else if (msg.type === 'external-export-failed') {
        const { fileName, error } = msg;
        figma.notify(`내보내기 실패: ${fileName} - ${error}`, { error: true });
    }
    else if (msg.type === 'notify') {
        figma.notify(msg.message);
    }
};

figma.on('run', async () => {
    // ★★★ 수정된 부분: 플러그인 실행 시, selectionchange와 동일한 로직을 실행합니다. ★★★
    console.log('[code.ts] figma.on(run) 실행. 선택된 이미지 정보를 바로 UI로 전송합니다.');
    await handleSelectionChange();
});