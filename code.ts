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
// ★★★ 수정된 부분: fills, width, height를 직접적으로 가지는 노드 타입 유니온으로 정의 (Ln 21 오류 해결) ★★★
type ImageCapableNode = RectangleNode | EllipseNode | PolygonNode | StarNode | VectorNode | TextNode | FrameNode;


// 새로운 타입 가드 함수 추가 (ImageCapableNode 타입 보장)
function isImageCapableNode(node: SceneNode): node is ImageCapableNode {
    // 1. node에 'fills', 'width', 'height' 속성이 있는지 확인
    // 이 타입 가드를 통과하면 node는 ImageCapableNode가 될 수 있는 후보가 됩니다.
    if (!('fills' in node) || !('width' in node) || !('height' in node)) {
        return false;
    }

    // ★★★ 수정된 부분: node.fills가 figma.mixed가 아닌지 먼저 확인 (Ln 231/232 오류 해결) ★★★
    // node.fills의 타입을 명시적으로 단언하여 TypeScript가 'any'로 보지 않도록 합니다.
    const actualFills = node.fills as (readonly Paint[] | typeof figma.mixed);

    // 2. actualFills가 figma.mixed인지 확인합니다.
    if (actualFills === figma.mixed) { 
        return false;
    }

    // 3. actualFills가 배열인지 확인합니다.
    if (!Array.isArray(actualFills)) {
        return false;
    }
    
    // 4. 'ImageCapableNode'에 정의된 특정 SceneNode 타입인지 확인합니다.
    const allowedTypes = new Set<NodeType>([
        'RECTANGLE', 'ELLIPSE', 'POLYGON', 'STAR', 'VECTOR', 'TEXT', 'FRAME'
    ]);
    if (!allowedTypes.has(node.type)) {
        return false;
    }

    // 위의 모든 조건을 통과하면 node는 ImageCapableNode 타입으로 간주합니다.
    return true;
}


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
    console.log(`[code.ts] sendAllImageDataToUI 시작. 후보 이미지 수: ${uniqueImageCandidates.length}`); // 디버깅 로그

    for (const candidate of uniqueImageCandidates) {
        if (candidate.imageBytes && candidate.url) {
            imagesDataForUI.push({
                nodeId: candidate.nodeId,
                name: candidate.nodeName,
                imageBytes: candidate.imageBytes.buffer,
                width: candidate.width,
                height: candidate.height,
                fileType: candidate.fileType,
                url: `data:image/${candidate.fileType.toLowerCase()};base64,${await figma.base64Encode(candidate.imageBytes)}`, // 올바른 MIME 타입과 Base64 인코딩
                imageHash: candidate.imageHash
            });
            console.log(`[code.ts] 캐시된 이미지 데이터 사용: ${candidate.nodeName}`); // 디버깅 로그
            continue;
        }

        const image = figma.getImageByHash(candidate.imageHash);
        if (image) {
            try {
                const bytes = await image.getBytesAsync();
                const imageURL = await figma.base64Encode(bytes);

                // 파일 확장자 추론 (필요 시)
                let fileType = 'PNG'; // 기본값
                if (bytes[0] === 0xFF && bytes[1] === 0xD8) fileType = 'JPG'; // JPEG
                else if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) fileType = 'PNG'; // PNG
                else if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
                         bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) fileType = 'WebP'; // WebP (RIFF, WEBP 시그니처)

                imagesDataForUI.push({
                    nodeId: candidate.nodeId,
                    name: candidate.nodeName,
                    imageBytes: bytes.buffer,
                    width: candidate.width,
                    height: candidate.height,
                    fileType: fileType, // ★★★ 수정: 실제 파일 타입 전달 ★★★
                    url: `data:image/${fileType.toLowerCase()};base64,${imageURL}`,
                    imageHash: candidate.imageHash
                });
                console.log(`[code.ts] 이미지 데이터 로드 및 추가: ${candidate.nodeName}, 타입: ${fileType}`); // 디버깅 로그
            } catch (e: any) {
                console.error(`[code.ts] 이미지 "${candidate.nodeName}" (Hash: ${candidate.imageHash}) 로드 중 오류 발생:`, e);
            }
        } else {
             console.warn(`[code.ts] 이미지 해시 "${candidate.imageHash}"에 해당하는 이미지 또는 노드에서 이미지를 찾을 수 없습니다. (노드: ${candidate.nodeName})`); // 디버깅 로그
        }
    }
    figma.ui.postMessage({ type: 'selection-image-data-batch', imagesData: imagesDataForUI });
    console.log(`[code.ts] 'selection-image-data-batch' 메시지 UI로 발송 완료. 총 ${imagesDataForUI.length}개 이미지.`); // 디버깅 로그
}

// 선택된 노드에서 고유한 이미지 해시를 가진 이미지 노드 정보를 추출하는 헬퍼 함수
function getUniqueImageCandidates(selection: readonly SceneNode[]): UniqueImageData[] {
    const uniqueImageMap = new Map<string, UniqueImageData>(); // Key: nodeId_imageHash
    console.log(`[code.ts] getUniqueImageCandidates 호출됨. 선택된 노드 수: ${selection.length}`); // 디버깅 로그
    
    for (const node of selection) {
        // isImageCapableNode 타입 가드를 사용하여 node가 ImageCapableNode임을 확인
        if (isImageCapableNode(node)) { 
            // node.fills는 이제 확실히 readonly Paint[] 타입입니다.
            // figma.mixed와의 비교는 isImageCapableNode 함수 내에서 이미 처리되었습니다.
            
            const fillsToFilter = node.fills as Paint[]; // readonly를 제거하고 Paint[]로 단언
            const imageFills: ImagePaint[] = fillsToFilter.filter((fill): fill is ImagePaint => fill.type === 'IMAGE' && fill.imageHash !== null);
            
            // imageFills는 ImagePaint[] 타입이므로 .length 접근은 안전합니다.
            if (imageFills.length > 0) { 
                console.log(`[code.ts] 노드 "${node.name}" (${node.id})에서 이미지 필드 ${imageFills.length}개 발견.`); // 디버깅 로그
            }

            for (const fill of imageFills) {
                const uniqueKey = `${node.id}_${fill.imageHash}`; 
                
                if (!uniqueImageMap.has(uniqueKey)) {
                    uniqueImageMap.set(uniqueKey, {
                        nodeId: node.id,
                        nodeName: node.name,
                        imageHash: fill.imageHash as string,
                        width: node.width,
                        height: node.height,
                        fileType: 'PNG' // 기본값으로 설정, 실제 타입은 sendAllImageDataToUI에서 결정될 수 있음
                    });
                    console.log(`[code.ts] 고유 이미지 후보 추가: ${node.name} (Hash: ${fill.imageHash})`); // 디버깅 로그
                } else {
                    console.log(`[code.ts] 중복 이미지 후보 건너뛰기: ${node.name} (Hash: ${fill.imageHash})`); // 디버깅 로그
                }
            }
        } else {
            // fills, width, height 중 하나라도 없거나 fills가 배열이 아니거나 figma.mixed인 SceneNode는 건너뜀
            console.log(`[code.ts] 노드 "${node.name}" (${node.id})는 이미지 처리 가능한 노드 타입이 아닙니다.`);
        }
    }
    const candidatesArray = Array.from(uniqueImageMap.values());
    console.log(`[code.ts] getUniqueImageCandidates 완료. 최종 고유 이미지 후보 수: ${candidatesArray.length}`); // 디버깅 로그
    return candidatesArray;
}

// ★★★ 변경: selectionchange 이벤트 디바운스 로직 강화 ★★★
let selectionChangeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_DELAY_MS = 200; // 딜레이를 200ms로 늘려 안정성 강화

async function handleSelectionChange() {
    console.log('[code.ts] handleSelectionChange 실행 (디바운스 후).'); // 디버깅 로그
    const uniqueImageCandidates = getUniqueImageCandidates(figma.currentPage.selection);
    
    figma.ui.postMessage({ type: 'selection-change', selectedNodeCount: uniqueImageCandidates.length });
    console.log(`[code.ts] 'selection-change' 메시지 UI로 발송. 선택된 노드 수: ${uniqueImageCandidates.length}`); // 디버깅 로그
    
    // 선택된 이미지가 있을 때만 데이터를 요청하도록 합니다.
    if (uniqueImageCandidates.length > 0) {
        console.log('[code.ts] 선택된 이미지가 있어 sendAllImageDataToUI 호출.'); // 디버깅 로그
        await sendAllImageDataToUI(uniqueImageCandidates);
    } else {
        // 선택된 이미지가 없으면 UI의 미리보기를 비우도록 명령합니다.
        figma.ui.postMessage({ type: 'selection-image-data-batch', imagesData: [] });
        console.log('[code.ts] 선택된 이미지가 없어 미리보기 초기화 메시지 발송.'); // 디버깅 로그
    }
    selectionChangeDebounceTimer = null;
}

figma.on('selectionchange', () => {
    console.log('[code.ts] selectionchange 이벤트 발생 (디바운스 시작).'); // 디버깅 로그
    if (selectionChangeDebounceTimer) {
        clearTimeout(selectionChangeDebounceTimer);
        console.log('[code.ts] 기존 selectionChangeDebounceTimer 클리어.'); // 디버깅 로그
    }
    selectionChangeDebounceTimer = setTimeout(handleSelectionChange, DEBOUNCE_DELAY_MS);
});


let totalImagesToProcess = 0;
let processedImageCount = 0;

// fills 속성을 가지며 이미지 최적화 대상이 될 수 있는 노드 타입을 정의합니다.
// 여기에 명시된 모든 타입은 'fills' 속성을 가집니다.
type ImageOptimizableNode = RectangleNode | EllipseNode | PolygonNode | StarNode | VectorNode | TextNode | FrameNode;

// 노드가 fills 속성을 가지며 ImageOptimizableNode 타입에 해당하는지 확인하는 타입 가드 함수
// 이 함수는 figma.ui.onmessage 밖에 선언되어야 합니다.
function isImageOptimizableNode(node: BaseNode | null): node is ImageOptimizableNode {
    // 1. null 체크
    if (!node) {
        return false;
    }

    // 2. SceneNode가 아닌 타입들 (BaseNode이지만 SceneNode가 아님)을 먼저 거릅니다.
    // BaseNode는 type 속성을 가집니다.
    const nonSceneNodeTypes = new Set([
        'DOCUMENT', 'PAGE', 'SHARED_PLUGIN_DATA', 'WIDGET', 'CODE_BLOCK', 'EMBED', 'SECTION'
    ]);
    if (nonSceneNodeTypes.has(node.type)) {
        return false;
    }

    // 이 시점에서 node는 SceneNode임이 보장됩니다.
    // 3. 'ImageOptimizableNode'에 해당하는 타입 중 하나인지 직접 확인합니다.
    const allowedTypes = new Set<NodeType>([
        'RECTANGLE', 'ELLIPSE', 'POLYGON', 'STAR', 'VECTOR', 'TEXT', 'FRAME'
    ]);
    if (!allowedTypes.has(node.type)) {
        return false; // 허용된 타입이 아니면 바로 false 반환
    }

    // 4. 허용된 타입 중에서도 'fills' 속성이 실제로 존재하는지, 그리고 배열인지 확인합니다.
    // (이 시점에서는 node는 ImageOptimizableNode union 타입으로 좁혀져 있으므로 fills 속성 접근이 안전합니다.)
    if (!('fills' in node) || !Array.isArray(node.fills)) {
        return false;
    }

    // ★★★ 문제의 라인 수정 (Ln 250) ★★★
    // 5. fills가 figma.mixed가 아닌지 확인합니다. (figma.mixed는 이터러블하지 않으므로)
    // node.fills가 'fills' in node 검사를 통과했지만 여전히 mixed일 가능성,
    // 그리고 Array.isArray(node.fills) 검사 후에도 TypeScript가 mixed를 배제하지 못하는 상황.
    // node.fills를 'any'로 캐스팅하여 TypeScript의 타입 추론 시스템을 회피합니다.
    // 이는 최후의 수단이며, 런타임에는 안전합니다.
    if ((node.fills as any) === figma.mixed) { // 여기서 'any'로 단언하여 타입 충돌 회피
        return false;
    }

    // 위의 모든 조건을 통과하면 ImageOptimizableNode로 간주합니다.
    return true;
}


figma.ui.onmessage = async (msg: { type: string; [key: string]: any }) => {
    console.log(`[code.ts] UI로부터 메시지 수신 - Type: ${msg.type}`);

    if (msg.type === 'resize-ui') {
        const { width, height } = msg;
        const minHeight = 100;
        const adjustedHeight = Math.max(minHeight, height);
        figma.ui.resize(width, adjustedHeight);
        console.log(`[code.ts] UI 크기 조정: ${width}x${adjustedHeight}`); // 디버깅 로그
    }
    
    else if (msg.type === 'request-all-image-data') {
        console.log(`[code.ts] 'request-all-image-data' 메시지 수신.`); // 디버깅 로그
        // UI가 데이터를 요청하면, 선택된 노드 정보를 가져와서 UI로 보냅니다.
        const uniqueImageCandidates = getUniqueImageCandidates(figma.currentPage.selection);
        if (uniqueImageCandidates.length > 0) {
            await sendAllImageDataToUI(uniqueImageCandidates);
        } else {
            figma.ui.postMessage({ type: 'selection-image-data-batch', imagesData: [] });
            console.log(`[code.ts] 요청된 이미지 데이터 없음. UI로 빈 배열 발송.`); // 디버깅 로그
        }
    }

    else if (msg.type === 'optimize-images') { // PNG, JPG를 Figma 내부에 적용
        const { resizePercentage, quality, fileFormats } = msg;
        const imagesToProcessCandidates = getUniqueImageCandidates(figma.currentPage.selection);
        console.log(`[code.ts] 'optimize-images' 메시지 수신. 포맷: ${fileFormats[0]}, 후보 이미지 수: ${imagesToProcessCandidates.length}`); // 디버깅 로그

        if (imagesToProcessCandidates.length === 0) {
            figma.notify('선택된 레이어에 이미지가 없습니다. 이미지로 채워진 레이어를 선택해주세요.', { error: true });
            console.warn('[code.ts] 최적화할 이미지가 없습니다. 사용자에게 알림.'); // 디버깅 로그
            return;
        }

        figma.notify(`이미지 ${imagesToProcessCandidates.length}개 최적화 중...`, { timeout: 3000 });
        totalImagesToProcess = imagesToProcessCandidates.length;
        processedImageCount = 0;
        console.log(`[code.ts] 총 처리할 이미지 수 설정: ${totalImagesToProcess}`); // 디버깅 로그

        for (const candidate of imagesToProcessCandidates) {
            const image = figma.getImageByHash(candidate.imageHash);
            
            if (image) {
                try {
                    const bytes = await image.getBytesAsync();
                    console.log(`[code.ts] 'process-image-data' (Figma 내부 적용) 발송: ${candidate.nodeName}`); // 디버깅 로그
                    figma.ui.postMessage({
                        type: 'process-image-data',
                        imageNodeId: candidate.nodeId,
                        imageBytes: bytes,
                        resizePercentage: resizePercentage,
                        quality: quality,
                        width: candidate.width,
                        height: candidate.height,
                        fileType: candidate.fileType, 
                        targetFormat: fileFormats[0], // UI에서 선택된 최종 포맷 전달 (PNG/JPG)
                        name: candidate.nodeName, // UI에서 사용할 노드 이름도 함께 전달
                        originalSize: bytes.byteLength // 원본 크기 전달
                    });
                } catch (e: any) {
                    console.error(`[code.ts] 이미지 "${candidate.nodeName}" (Hash: ${candidate.imageHash}) 로드 중 오류 발생:`, e); // 디버깅 로그
                    figma.notify(`오류: 이미지 "${candidate.nodeName}" (Hash: ${candidate.imageHash}) 로드 중 오류 발생:`, { error: true });
                }
            } else {
                console.warn(`[code.ts] Figma에서 이미지 해시 ${candidate.imageHash}를 찾을 수 없습니다. (노드: ${candidate.nodeName})`); // 디버깅 로그
            }
        }
    }
    
    // ★★★ 추가: WebP 내보내기 요청 처리 로직 (UI에서 요청) ★★★
    else if (msg.type === 'export-images-as-webp') {
        const { imagesToExport, resizePercentage, quality } = msg;
        totalImagesToProcess = imagesToExport.length;
        processedImageCount = 0;
        figma.notify(`WebP 이미지 ${imagesToExport.length}개 내보내기 중...`, { timeout: 3000 });
        console.log(`[code.ts] 'export-images-as-webp' 수신. 총 ${totalImagesToProcess}개의 WebP 이미지 처리 시작.`); // 디버깅 로그

        for (const imgData of imagesToExport) {
            console.log(`[code.ts] 'process-image-data' (WebP 생성) 발송: ${imgData.name}`); // 디버깅 로그
            figma.ui.postMessage({
                type: 'process-image-data', // ui.html의 optimizeImage 함수를 재활용
                imageNodeId: imgData.nodeId,
                imageBytes: new Uint8Array(imgData.imageBytes),
                resizePercentage: resizePercentage,
                quality: quality,
                width: imgData.width,
                height: imgData.height,
                fileType: imgData.fileType,
                targetFormat: 'WebP', // WebP로 최적화 요청
                name: imgData.name, // 파일 다운로드를 위해 이름 전달
                originalSize: imgData.originalSize // 원본 크기 전달
            });
        }
    }

    // ★★★ 추가: WebP 이미지 최적화 완료 후 UI로 다운로드 지시 메시지 발송 ★★★
    else if (msg.type === 'webp-export-complete') {
        // UI에서 WebP 최적화가 완료되어 최종 다운로드 준비가 되었다는 메시지를 받음
        const { optimizedBytes, name, originalSize, targetFormat, nodeId } = msg; 

        console.log(`[code.ts] 'webp-export-complete' 메시지 수신 (UI로부터). 파일명: ${name}, 크기: ${formatBytes(optimizedBytes.byteLength)}`);

        // 이제 code.ts가 UI에게 실제 다운로드를 트리거하라고 명령합니다.
        figma.ui.postMessage({
            type: 'trigger-download', // UI가 받아서 다운로드를 실행할 메시지 타입
            fileName: `${name.replace(/\.[^/.]+$/, "")}.${targetFormat.toLowerCase()}`, // 파일 이름 생성
            bytes: optimizedBytes, // 다운로드할 파일의 바이트 데이터 (ArrayBuffer)
            originalSize: originalSize,
            optimizedSize: optimizedBytes.byteLength
        });
        console.log(`[code.ts] UI로 'trigger-download' 메시지 발송 완료. (파일명: ${name})`); // 디버깅 로그

        // 전체 작업이 완료되었음을 사용자에게 알림 (선택 사항)
        processedImageCount++;
        if (processedImageCount === totalImagesToProcess) {
            figma.notify(`WebP 이미지 내보내기가 완료되었습니다! (${totalImagesToProcess}개)`);
            totalImagesToProcess = 0;
            processedImageCount = 0;
            console.log(`[code.ts] 모든 WebP 이미지 처리 완료 알림.`); // 디버깅 로그
        }
    }

    else if (msg.type === 'image-optimization-complete') {
        const { imageNodeId, optimizedBytes, originalSize, targetFormat } = msg;
        console.log(`[code.ts] 'image-optimization-complete' 메시지 수신 (UI로부터). 노드 ID: ${imageNodeId}, 포맷: ${targetFormat}`); // 디버깅 로그
        
        // 이 블록은 이제 PNG/JPG만 처리하도록 합니다. (Figma 내부에 적용)
        if (targetFormat === 'PNG' || targetFormat === 'JPG') { 
            const node = await figma.getNodeByIdAsync(imageNodeId);

            // isImageOptimizableNode 함수가 BaseNode|null을 받도록 수정했으므로, node를 직접 전달.
            // isImageOptimizableNode를 통과하면 node는 ImageOptimizableNode 타입으로 추론됨.
            if (isImageOptimizableNode(node)) {
                try {
                    const newImageHash = figma.createImage(new Uint8Array(optimizedBytes)).hash;
                    const newFills: Paint[] = [];
                    let fillUpdatedForNode = false; // 해당 노드에서 최소 하나의 이미지 fill이 업데이트되었는지 추적

                    // node.fills는 이제 ImageOptimizableNode에 의해 Paint[]임이 보장되며, figma.mixed도 아님.
                    for (const fill of node.fills as Paint[]) { // 더 이상 오류 발생하지 않음 (타입 가드 강화)
                        if (fill.type === 'IMAGE' && fill.imageHash) { // 이미 채우기가 이미지인 경우
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
                    
                    // fills 배열을 항상 할당하는 방식으로 변경.
                    // node는 이미 ImageOptimizableNode이므로 안전하게 fills에 접근 가능.
                    node.fills = newFills; 
                    console.log(`[code.ts] 노드 "${node.name || imageNodeId}"의 fills 업데이트 완료.`); // 디버깅 로그
                    

                    processedImageCount++;
                    if (processedImageCount === totalImagesToProcess) {
                        figma.notify(`이미지 최적화가 완료되었습니다! (${totalImagesToProcess}개)`);
                        totalImagesToProcess = 0;
                        processedImageCount = 0;
                        console.log(`[code.ts] 모든 PNG/JPG 이미지 처리 완료 알림.`); // 디버깅 로그
                    }

                } catch (error: any) {
                    console.error(`[code.ts] Figma 노드 "${node.name || imageNodeId}" 업데이트 실패:`, error); // 오류 로그 추가
                    figma.notify(`오류: 이미지 "${node.name || imageNodeId}" 업데이트에 실패했습니다.`, { error: true });
                }
            } else {
                // 이 else 블록은 node가 null이거나, isImageOptimizableNode를 통과하지 못한 경우에 해당합니다.
                // (즉, 이미지 최적화 대상이 아닌 노드 타입)
                console.warn(`[code.ts] 최적화된 이미지를 적용할 수 없는 노드 타입 또는 fills 속성 없음 (node: ${node?.type}, id: ${imageNodeId}, isOptimizable: ${isImageOptimizableNode(node)}):`, node); // 경고 로그 상세화
                figma.notify(`오류: 최적화된 이미지를 적용할 노드를 찾을 수 없습니다. (ID: ${imageNodeId}, Type: ${node?.type || '알 수 없음'})`, { error: true });
            }
        } else {
             console.log(`[code.ts] 'image-optimization-complete' 받았으나, 타겟 포맷(${targetFormat})은 Figma 내부에 적용되지 않습니다.`); // 디버깅 로그
        }
    }

    else if (msg.type === 'image-optimization-failed') {
        const { imageNodeId, error } = msg;
        console.error(`[code.ts] 이미지 최적화 실패 (노드 ID: ${imageNodeId}): ${error}`); // 디버깅 로그
        figma.notify(`오류: 이미지 ${imageNodeId} 처리 중 문제가 발생했습니다: ${error}`, { error: true });
    }

    else if (msg.type === 'external-export-complete') {
        const { fileName, originalSize, optimizedSize } = msg;
        console.log(`[code.ts] 'external-export-complete' 수신. 파일명: ${fileName}, 원본: ${formatBytes(originalSize)}, 최적화: ${formatBytes(optimizedSize)}`); // 디버깅 로그
        figma.notify(`내보내기 완료: ${fileName} (${formatBytes(originalSize)} → ${formatBytes(optimizedSize)})`);
    } else if (msg.type === 'external-export-failed') {
        const { fileName, error } = msg;
        console.error(`[code.ts] 'external-export-failed' 수신. 파일명: ${fileName}, 오류: ${error}`); // 디버깅 로그
        figma.notify(`내보내기 실패: ${fileName} - ${error}`, { error: true });
    }
    else if (msg.type === 'notify') {
        console.log(`[code.ts] 'notify' 메시지 수신: ${msg.message}`); // 디버깅 로그
        figma.notify(msg.message);
    }
    else {
        console.warn(`[code.ts] 알 수 없는 메시지 타입 수신: ${msg.type}`, msg); // 알 수 없는 메시지 타입 디버깅
    }
};

figma.on('run', async () => {
    // ★★★ 수정된 부분: 플러그인 실행 시, selectionchange와 동일한 로직을 실행합니다. ★★★
    console.log('[code.ts] figma.on(run) 실행. 선택된 이미지 정보를 바로 UI로 전송합니다.'); // 디버깅 로그
    await handleSelectionChange();
});