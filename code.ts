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
// GroupNode는 fills를 직접 가지지 않으므로 여기서 제외합니다.
type ImageCapableNode = RectangleNode | EllipseNode | PolygonNode | StarNode | VectorNode | TextNode | FrameNode | ComponentNode | InstanceNode;

// 새로운 타입 가드 함수 추가 (ImageCapableNode 타입 보장)
function isImageCapableNode(node: SceneNode): node is ImageCapableNode {
    // SceneNode 중 fills, width, height 속성을 가지는 타입만 필터링합니다.
    // GroupNode는 fills를 직접 가지지 않으므로 이 단계에서 걸러집니다.
    if (!('fills' in node) || !('width' in node) || !('height' in node)) {
        return false;
    }

    // fills가 mixed 타입인 경우 (여러 fill이 섞여있어 단일 이미지로 처리하기 어려움)
    const actualFills = node.fills as (readonly Paint[] | typeof figma.mixed);
    if (actualFills === figma.mixed) {
        return false;
    }

    // fills가 배열이 아닌 경우 (예: 다른 종류의 fill)
    if (!Array.isArray(actualFills)) {
        return false;
    }
    
    // 특정 노드 타입만 이미지 처리를 허용
    const allowedTypes = new Set<NodeType>([
        'RECTANGLE', 'ELLIPSE', 'POLYGON', 'STAR', 'VECTOR', 'TEXT', 'FRAME', 'COMPONENT', 'INSTANCE'
    ]);
    if (!allowedTypes.has(node.type)) {
        return false;
    }

    // 최소 하나라도 IMAGE 타입의 fill이 있어야 함
    const hasImageFill = actualFills.some((fill: Paint): fill is ImagePaint => fill.type === 'IMAGE' && fill.imageHash !== null);
    if (!hasImageFill) {
        return false;
    }

    return true;
}


// 고유한 이미지 데이터를 저장할 타입 정의 (노드 + 이미지 해시)
interface UniqueImageData {
    nodeId: string;
    nodeName: string;
    imageHash: string; // 이미지의 고유 해시
    imageBytes?: Uint8Array; // UI로 전송할 실제 바이트
    width: number; // 원본 노드의 너비
    height: number; // 원본 노드의 높이
    fileType: string;
    url?: string; // 썸네일 URL (base64 인코딩)
}

/**
 * 선택된 모든 이미지 노드에서 데이터를 추출하여 UI로 일괄 전송합니다.
 * @param uniqueImageCandidates 고유한 이미지 노드 후보 배열 (getUniqueImageCandidates에서 파싱된 결과)
 */
async function sendAllImageDataToUI(uniqueImageCandidates: UniqueImageData[]): Promise<void> {
    const imagesDataForUI = [];
    console.log(`[code.ts] sendAllImageDataToUI 시작. 후보 이미지 수: ${uniqueImageCandidates.length}`);

    for (const candidate of uniqueImageCandidates) {
        // 이미 imageBytes와 url이 있다면 (이전에 로드된 경우) 건너뛰기
        if (candidate.imageBytes && candidate.url) {
            imagesDataForUI.push({
                nodeId: candidate.nodeId,
                name: candidate.nodeName,
                imageBytes: candidate.imageBytes.buffer,
                width: candidate.width,
                height: candidate.height,
                fileType: candidate.fileType,
                url: candidate.url, // 이미 base64 URL이 저장되어 있다면 재사용
                imageHash: candidate.imageHash
            });
            console.log(`[code.ts] 캐시된 이미지 데이터 사용: ${candidate.nodeName}`);
            continue;
        }

        const image = figma.getImageByHash(candidate.imageHash);
        if (image) {
            try {
                const bytes = await image.getBytesAsync();
                const imageURL = await figma.base64Encode(bytes); // base64 인코딩

                let fileType = 'PNG'; // 기본값
                // 바이트 시그니처를 통한 파일 타입 추정
                if (bytes[0] === 0xFF && bytes[1] === 0xD8) fileType = 'JPG';
                else if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) fileType = 'PNG';
                else if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
                         bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) fileType = 'WebP';

                imagesDataForUI.push({
                    nodeId: candidate.nodeId,
                    name: candidate.nodeName,
                    imageBytes: bytes.buffer, // ArrayBuffer로 전송
                    width: candidate.width,
                    height: candidate.height,
                    fileType: fileType,
                    url: `data:image/${fileType.toLowerCase()};base64,${imageURL}`,
                    imageHash: candidate.imageHash
                });
                console.log(`[code.ts] 이미지 데이터 로드 및 추가: ${candidate.nodeName}, 타입: ${fileType}`);
            } catch (e: any) {
                console.error(`[code.ts] 이미지 "${candidate.nodeName}" (Hash: ${candidate.imageHash}) 로드 중 오류 발생:`, e);
                // 오류 발생 시에도 최소한의 정보를 UI로 보내 처리할 수 있도록 빈 바이트 배열로 푸시
                imagesDataForUI.push({
                    nodeId: candidate.nodeId,
                    name: candidate.nodeName,
                    imageBytes: new Uint8Array([]).buffer,
                    width: candidate.width,
                    height: candidate.height,
                    fileType: 'UNKNOWN',
                    url: '',
                    imageHash: candidate.imageHash
                });
            }
        } else {
             console.warn(`[code.ts] 이미지 해시 "${candidate.imageHash}"에 해당하는 이미지 또는 노드에서 이미지를 찾을 수 없습니다. (노드: ${candidate.nodeName})`);
        }
    }
    figma.ui.postMessage({ type: 'selection-image-data-batch', imagesData: imagesDataForUI });
    console.log(`[code.ts] 'selection-image-data-batch' 메시지 UI로 발송 완료. 총 ${imagesDataForUI.length}개 이미지.`);
}

// 선택된 노드에서 고유한 이미지 해시를 가진 이미지 노드 정보를 추출하는 헬퍼 함수
function getUniqueImageCandidates(selection: readonly SceneNode[]): UniqueImageData[] {
    const uniqueImageMap = new Map<string, UniqueImageData>(); 
    console.log(`[code.ts] getUniqueImageCandidates 호출됨. 선택된 노드 수: ${selection.length}`);
    
    // 재귀적으로 자식 노드를 탐색하는 함수
    function traverse(node: SceneNode) {
        // GroupNode는 직접 fills를 가지지 않으므로, isImageCapableNode를 통과하지 못합니다.
        // 하지만 GroupNode의 자식 노드에는 ImageCapableNode가 있을 수 있으므로 재귀 탐색은 계속합니다.
        if (isImageCapableNode(node)) { 
            const fillsToFilter = node.fills as Paint[]; 
            const imageFills: ImagePaint[] = fillsToFilter.filter((fill: Paint): fill is ImagePaint => fill.type === 'IMAGE' && fill.imageHash !== null);
            
            if (imageFills.length > 0) { 
                console.log(`[code.ts] 노드 "${node.name}" (${node.id})에서 이미지 필드 ${imageFills.length}개 발견.`); 
            }

            for (const fill of imageFills) {
                // 노드 ID와 이미지 해시를 조합하여 고유 키 생성
                const uniqueKey = `${node.id}_${fill.imageHash}`; 
                
                if (!uniqueImageMap.has(uniqueKey)) {
                    uniqueImageMap.set(uniqueKey, {
                        nodeId: node.id,
                        nodeName: node.name,
                        imageHash: fill.imageHash as string,
                        width: node.width,
                        height: node.height,
                        fileType: 'PNG' // 기본값, 나중에 getBytesAsync로 정확히 판별
                    });
                    console.log(`[code.ts] 고유 이미지 후보 추가: ${node.name} (Hash: ${fill.imageHash})`);
                } else {
                    console.log(`[code.ts] 중복 이미지 후보 건너뛰기: ${node.name} (Hash: ${fill.imageHash})`);
                }
            }
        }

        // 컨테이너 노드인 경우 자식 노드 탐색 (GroupNode도 children을 가집니다)
        if ('children' in node && node.children) {
            for (const child of node.children) {
                traverse(child);
            }
        }
    }

    // 선택된 모든 노드에 대해 탐색 시작
    for (const node of selection) {
        traverse(node);
    }

    const candidatesArray = Array.from(uniqueImageMap.values());
    console.log(`[code.ts] getUniqueImageCandidates 완료. 최종 고유 이미지 후보 수: ${candidatesArray.length}`);
    return candidatesArray;
}

let selectionChangeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_DELAY_MS = 200;

async function handleSelectionChange() {
    console.log('[code.ts] handleSelectionChange 실행 (디바운스 후).');
    const uniqueImageCandidates = getUniqueImageCandidates(figma.currentPage.selection);
    
    figma.ui.postMessage({ type: 'selection-change', selectedNodeCount: uniqueImageCandidates.length });
    console.log(`[code.ts] 'selection-change' 메시지 UI로 발송. 선택된 노드 수: ${uniqueImageCandidates.length}`);
    
    if (uniqueImageCandidates.length > 0) {
        console.log('[code.ts] 선택된 이미지가 있어 sendAllImageDataToUI 호출.');
        await sendAllImageDataToUI(uniqueImageCandidates);
    } else {
        figma.ui.postMessage({ type: 'selection-image-data-batch', imagesData: [] });
        console.log('[code.ts] 선택된 이미지가 없어 미리보기 초기화 메시지 발송.');
    }
    selectionChangeDebounceTimer = null;
}

figma.on('selectionchange', () => {
    console.log('[code.ts] selectionchange 이벤트 발생 (디바운스 시작).');
    if (selectionChangeDebounceTimer) {
        clearTimeout(selectionChangeDebounceTimer);
        console.log('[code.ts] 기존 selectionChangeDebounceTimer 클리어.');
    }
    selectionChangeDebounceTimer = setTimeout(handleSelectionChange, DEBOUNCE_DELAY_MS);
});


let totalImagesToProcess = 0;
let processedImageCount = 0;

// 이미지 채우기가 가능한 노드 타입 (resize 메서드를 가지며 fills를 수정할 수 있는)
type ImageOptimizableNode = RectangleNode | EllipseNode | PolygonNode | StarNode | VectorNode | TextNode | FrameNode | ComponentNode | InstanceNode;

function isImageOptimizableNode(node: BaseNode | null): node is ImageOptimizableNode {
    if (!node) {
        return false;
    }

    // SceneNode가 아니거나, fills 속성이 없거나 배열이 아닌 경우 제외
    // GroupNode는 여기서 'fills' in node에서 false가 되어 걸러집니다.
    if (!('fills' in node) || (node.fills as any) === figma.mixed || !Array.isArray(node.fills)) {
        return false;
    }

    // resize 메서드를 가지고 있는지 확인
    if (!('resize' in node) || typeof node.resize !== 'function') {
        return false;
    }

    // 이미지 필을 포함할 수 있는 특정 노드 타입만 허용
    const allowedTypes = new Set<NodeType>([
        'RECTANGLE', 'ELLIPSE', 'POLYGON', 'STAR', 'VECTOR', 'TEXT', 'FRAME', 'COMPONENT', 'INSTANCE'
    ]);
    if (!allowedTypes.has(node.type)) {
        return false;
    }
    
    // 최소 하나라도 IMAGE 타입의 fill이 있어야 함
    const hasImageFill = (node.fills as Paint[]).some((fill: Paint): fill is ImagePaint => fill.type === 'IMAGE' && fill.imageHash !== null);
    if (!hasImageFill) {
        return false;
    }

    return true;
}


figma.ui.onmessage = async (msg: { type: string; [key: string]: any }) => {
    console.log(`[code.ts] UI로부터 메시지 수신 - Type: ${msg.type}`);

    if (msg.type === 'resize-ui') {
        const { width, height } = msg;
        const minHeight = 100;
        const adjustedHeight = Math.max(minHeight, height);
        figma.ui.resize(width, adjustedHeight);
        console.log(`[code.ts] UI 크기 조정: ${width}x${adjustedHeight}`);
    }
    
    else if (msg.type === 'request-all-image-data') {
        console.log(`[code.ts] 'request-all-image-data' 메시지 수신.`);
        const uniqueImageCandidates = getUniqueImageCandidates(figma.currentPage.selection);
        if (uniqueImageCandidates.length > 0) {
            await sendAllImageDataToUI(uniqueImageCandidates);
        } else {
            figma.ui.postMessage({ type: 'selection-image-data-batch', imagesData: [] });
            console.log(`[code.ts] 요청된 이미지 데이터 없음. UI로 빈 배열 발송.`);
        }
    }

    else if (msg.type === 'optimize-images') { // PNG, JPG를 Figma 내부에 적용
        const { imagesToOptimize, scaleValue, pixelDensity, quality, fileFormats } = msg; 
        console.log(`[code.ts] 'optimize-images' 메시지 수신. 스케일: ${scaleValue}, 픽셀밀도: ${pixelDensity}%, 포맷: ${fileFormats[0]}, 이미지 수: ${imagesToOptimize.length}`);

        if (imagesToOptimize.length === 0) {
            figma.notify('선택된 레이어에 이미지가 없습니다. 이미지로 채워진 레이어를 선택해주세요.', { error: true });
            console.warn('[code.ts] 최적화할 이미지가 없습니다. 사용자에게 알림.');
            return;
        }

        figma.notify(`이미지 ${imagesToOptimize.length}개 최적화 중...`, { timeout: 3000 });
        totalImagesToProcess = imagesToOptimize.length;
        processedImageCount = 0;
        console.log(`[code.ts] 총 처리할 이미지 수 설정: ${totalImagesToProcess}`);

        for (const imgData of imagesToOptimize) {
            console.log(`[code.ts] 'process-image-data' (Figma 내부 적용) 발송: ${imgData.name}`);
            figma.ui.postMessage({
                type: 'process-image-data',
                imageNodeId: imgData.nodeId,
                imageBytes: imgData.imageBytes, 
                scaleValue: scaleValue, 
                pixelDensity: pixelDensity,
                quality: quality,
                width: imgData.width, // 원본 노드의 width
                height: imgData.height, // 원본 노드의 height
                fileType: imgData.fileType, 
                targetFormat: fileFormats[0], 
                name: imgData.name, 
                originalSize: imgData.originalSize 
            });
        }
    }
    
    else if (msg.type === 'export-images-as-webp') {
        const { imagesToExport, scaleValue, pixelDensity, quality } = msg; 
        totalImagesToProcess = imagesToExport.length;
        processedImageCount = 0;
        figma.notify(`WebP 이미지 ${imagesToExport.length}개 내보내기 중...`, { timeout: 3000 });
        console.log(`[code.ts] 'export-images-as-webp' 수신. 총 ${totalImagesToProcess}개의 WebP 이미지 처리 시작. 스케일: ${scaleValue}, 픽셀밀도: ${pixelDensity}%`);

        for (const imgData of imagesToExport) {
            console.log(`[code.ts] 'process-image-data' (WebP 생성) 발송: ${imgData.name}`);
            figma.ui.postMessage({
                type: 'process-image-data', 
                imageNodeId: imgData.nodeId,
                imageBytes: imgData.imageBytes, 
                scaleValue: scaleValue, 
                pixelDensity: pixelDensity,
                quality: quality,
                width: imgData.width, // 원본 노드의 width
                height: imgData.height, // 원본 노드의 height
                fileType: imgData.fileType,
                targetFormat: 'WebP', 
                name: imgData.name, 
                originalSize: imgData.originalSize 
            });
        }
    }

    else if (msg.type === 'webp-export-complete') {
        // optimizedWidth, optimizedHeight는 이제 Scale만 적용된 크기 (Figma 레이어 크기)
        // actualImagePixelWidth, actualImagePixelHeight는 실제 생성된 이미지 파일의 픽셀 개수
        const { optimizedBytes, name, originalSize, targetFormat, nodeId, optimizedWidth, optimizedHeight, actualImagePixelWidth, actualImagePixelHeight } = msg; 

        console.log(`[code.ts] 'webp-export-complete' 메시지 수신 (UI로부터). 파일명: ${name}, 크기: ${formatBytes(optimizedBytes.byteLength)}, Figma 레이어 크기: ${optimizedWidth}x${optimizedHeight}, 실제 이미지 픽셀: ${actualImagePixelWidth}x${actualImagePixelHeight}`);

        figma.ui.postMessage({
            type: 'trigger-download', 
            fileName: `${name.replace(/\.[^/.]+$/, "")}.${targetFormat.toLowerCase()}`, 
            bytes: optimizedBytes, 
            originalSize: originalSize,
            optimizedSize: optimizedBytes.byteLength,
            optimizedWidth: optimizedWidth, // Figma 레이어 크기로 사용될 Scale만 적용된 크기
            optimizedHeight: optimizedHeight // Figma 레이어 크기로 사용될 Scale만 적용된 크기
        }, { origin: '*' }); 
        console.log(`[code.ts] UI로 'trigger-download' 메시지 발송 완료. (파일명: ${name})`);

        processedImageCount++;
        if (processedImageCount === totalImagesToProcess) {
            figma.notify(`WebP 이미지 내보내기가 완료되었습니다! (${totalImagesToProcess}개)`);
            totalImagesToProcess = 0;
            processedImageCount = 0;
            console.log(`[code.ts] 모든 WebP 이미지 처리 완료 알림.`);
        }
    }

    else if (msg.type === 'image-optimization-complete') {
        // optimizedWidth, optimizedHeight는 이제 Scale만 적용된 크기 (Figma 레이어 크기)
        // actualImagePixelWidth, actualImagePixelHeight는 실제 생성된 이미지 파일의 픽셀 개수
        const { imageNodeId, optimizedBytes, originalSize, targetFormat, optimizedWidth, optimizedHeight, actualImagePixelWidth, actualImagePixelHeight } = msg;
        console.log(`[code.ts] 'image-optimization-complete' 메시지 수신 (UI로부터). 노드 ID: ${imageNodeId}, 포맷: ${targetFormat}, Figma 레이어 크기: ${optimizedWidth}x${optimizedHeight}, 실제 이미지 픽셀: ${actualImagePixelWidth}x${actualImagePixelHeight}`);
        
        if (targetFormat === 'PNG' || targetFormat === 'JPG') { 
            const node = await figma.getNodeByIdAsync(imageNodeId);

            if (isImageOptimizableNode(node)) {
                try {
                    const newImageHash = figma.createImage(new Uint8Array(optimizedBytes)).hash;
                    const newFills: Paint[] = [];
                    let fillUpdatedForNode = false; 

                    for (const fill of node.fills as Paint[]) { 
                        if (fill.type === 'IMAGE' && fill.imageHash) { 
                            if (!fillUpdatedForNode) { 
                                newFills.push({ ...fill, imageHash: newImageHash });
                                fillUpdatedForNode = true;
                            } else {
                                newFills.push(fill); 
                            }
                        } else {
                            newFills.push(fill); 
                        }
                    }
                    
                    node.fills = newFills; 
                    console.log(`[code.ts] 노드 "${node.name || imageNodeId}"의 fills 업데이트 완료.`);

                    // ★★★ 수정된 부분: 노드의 크기를 UI에서 전달받은 'Scale만 적용된 크기'로 조정 ★★★
                    // 이 크기가 Figma 레이어의 최종 경계 상자 크기가 됩니다.
                    if (optimizedWidth && optimizedHeight) {
                        node.resize(optimizedWidth, optimizedHeight);
                        console.log(`[code.ts] 노드 "${node.name || imageNodeId}" 크기 조정됨 (Scale만): ${optimizedWidth}x${optimizedHeight}`);
                        // 이 시점에서 Figma는 optimizedWidth/Height 레이어 안에 actualImagePixelWidth/Height 이미지를 확대/축소하여 표시합니다.
                    } else {
                        console.warn(`[code.ts] 최적화된 이미지의 Scale 적용 크기 정보(optimizedWidth, optimizedHeight)가 없어 노드 크기를 업데이트하지 못했습니다. 노드: ${node.name || imageNodeId}`);
                    }
                    
                    processedImageCount++;
                    if (processedImageCount === totalImagesToProcess) {
                        figma.notify(`이미지 최적화가 완료되었습니다! (${totalImagesToProcess}개)`);
                        totalImagesToProcess = 0;
                        processedImageCount = 0;
                        console.log(`[code.ts] 모든 PNG/JPG 이미지 처리 완료 알림.`);
                    }

                } catch (error: any) {
                    console.error(`[code.ts] Figma 노드 "${node.name || imageNodeId}" 업데이트 실패:`, error);
                    figma.notify(`오류: 이미지 "${node.name || imageNodeId}" 업데이트에 실패했습니다.`, { error: true });
                }
            } else {
                console.warn(`[code.ts] 최적화된 이미지를 적용할 수 없는 노드 타입 또는 fills 속성 없음 (node: ${node?.type}, id: ${imageNodeId}, isOptimizable: ${isImageOptimizableNode(node)}):`, node);
                figma.notify(`오류: 최적화된 이미지를 적용할 노드를 찾을 수 없습니다. (ID: ${imageNodeId}, Type: ${node?.type || '알 수 없음'})`, { error: true });
            }
        } else {
             console.log(`[code.ts] 'image-optimization-complete' 받았으나, 타겟 포맷(${targetFormat})은 Figma 내부에 적용되지 않습니다.`);
        }
    }

    else if (msg.type === 'image-optimization-failed') {
        const { imageNodeId, error } = msg;
        console.error(`[code.ts] 이미지 최적화 실패 (노드 ID: ${imageNodeId}): ${error}`);
        figma.notify(`오류: 이미지 ${imageNodeId} 처리 중 문제가 발생했습니다: ${error}`, { error: true });
    }

    else if (msg.type === 'external-export-complete') {
        const { fileName, originalSize, optimizedSize } = msg;
        console.log(`[code.ts] 'external-export-complete' 수신. 파일명: ${fileName}, 원본: ${formatBytes(originalSize)}, 최적화: ${formatBytes(optimizedSize)}`);
        figma.notify(`내보내기 완료: ${fileName} (${formatBytes(originalSize)} → ${formatBytes(optimizedSize)})`);
    } else if (msg.type === 'external-export-failed') {
        const { fileName, error } = msg;
        console.error(`[code.ts] 'external-export-failed' 수신. 파일명: ${fileName}, 오류: ${error}`);
        figma.notify(`내보내기 실패: ${fileName} - ${error}`, { error: true });
    }
    else if (msg.type === 'notify') {
        console.log(`[code.ts] 'notify' 메시지 수신: ${msg.message}`);
        figma.notify(msg.message);
    }
    else {
        console.warn(`[code.ts] 알 수 없는 메시지 타입 수신: ${msg.type}`, msg);
    }
};

figma.on('run', async () => {
    console.log('[code.ts] figma.on(run) 실행. 선택된 이미지 정보를 바로 UI로 전송합니다.');
    await handleSelectionChange();
});