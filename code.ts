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

/**
 * 선택된 모든 이미지 노드에서 데이터를 추출하여 UI로 일괄 전송합니다.
 * @param nodes 이미지 노드 배열
 */
async function sendAllImageDataToUI(nodes: ImageCapableNode[]): Promise<void> {
    const imagesData = [];
    for (const node of nodes) {
        if (!('fills' in node && Array.isArray(node.fills) && 'width' in node && 'height' in node)) {
            continue;
        }
        const imageFill = (node.fills as Paint[]).find((fill): fill is ImagePaint => fill.type === 'IMAGE' && fill.imageHash !== null);

        if (imageFill && imageFill.imageHash) {
            const image = figma.getImageByHash(imageFill.imageHash);
            if (image) {
                try {
                    const bytes = await image.getBytesAsync();
                    const fileTypeForUI = 'PNG';
                    const imageURL = await figma.base64Encode(bytes);

                    imagesData.push({
                        nodeId: node.id,
                        name: node.name,
                        imageBytes: bytes.buffer,
                        width: node.width,
                        height: node.height,
                        fileType: fileTypeForUI,
                        url: `data:image/png;base64,${imageURL}`
                    });
                } catch (e: any) {
                    console.error(`[code.ts] 이미지 "${node.name}" 로드 중 오류 발생:`, e);
                }
            }
        }
    }
    figma.ui.postMessage({ type: 'selection-image-data-batch', imagesData: imagesData });
}

figma.on('selectionchange', async () => {
    const selectedNodes = figma.currentPage.selection;
    const imageNodes: ImageCapableNode[] = selectedNodes.filter(node =>
        'fills' in node && Array.isArray(node.fills) &&
        (node.fills as Paint[]).some(fill => fill.type === 'IMAGE' && fill.imageHash !== null) &&
        'width' in node && 'height' in node && node.width > 0 && node.height > 0
    ) as ImageCapableNode[];

    figma.ui.postMessage({ type: 'selection-change', selectedNodeCount: imageNodes.length });
});

// ★★★ 추가: 최적화 완료된 이미지 개수를 추적하는 변수 ★★★
let totalImagesToProcess = 0;
let processedImageCount = 0;

figma.ui.onmessage = async (msg: { type: string; [key: string]: any }) => {
    if (msg.type === 'resize-ui') {
        const { width, height } = msg;
        const minHeight = 100;
        const adjustedHeight = Math.max(minHeight, height);
        figma.ui.resize(width, adjustedHeight);
    }
    
    else if (msg.type === 'request-all-image-data') {
        const selectedNodes = figma.currentPage.selection;
        const imageNodes: ImageCapableNode[] = selectedNodes.filter(node =>
            'fills' in node && Array.isArray(node.fills) &&
            (node.fills as Paint[]).some(fill => fill.type === 'IMAGE' && fill.imageHash !== null) &&
            'width' in node && 'height' in node && node.width > 0 && node.height > 0
        ) as ImageCapableNode[];

        if (imageNodes.length > 0) {
            await sendAllImageDataToUI(imageNodes);
        } else {
            figma.ui.postMessage({ type: 'selection-image-data-batch', imagesData: [] });
        }
    }

    else if (msg.type === 'optimize-images') {
        const { resizePercentage, quality, fileFormats } = msg;
        const selectedNodes = figma.currentPage.selection;
        const imagesToProcess: ImageCapableNode[] = selectedNodes.filter(node =>
            'fills' in node && Array.isArray(node.fills) &&
            (node.fills as Paint[]).some(fill => fill.type === 'IMAGE' && fill.imageHash !== null)
        ) as ImageCapableNode[];

        if (imagesToProcess.length === 0) {
            figma.notify('선택된 레이어에 이미지가 없습니다. 이미지로 채워진 레이어를 선택해주세요.', { error: true });
            return;
        }

        // ★★★ 변경: 최적화 시작 알림 및 전체 이미지 개수 설정 ★★★
        figma.notify(`이미지 ${imagesToProcess.length}개 최적화 중...`, { timeout: 3000 });
        totalImagesToProcess = imagesToProcess.length;
        processedImageCount = 0;

        for (const node of imagesToProcess) {
            const imageFill = (node.fills as Paint[]).find((fill): fill is ImagePaint => fill.type === 'IMAGE' && fill.imageHash !== null);
            
            if (imageFill && imageFill.imageHash) {
                const image = figma.getImageByHash(imageFill.imageHash);
                if (image) {
                    try {
                        const bytes = await image.getBytesAsync();
                        figma.ui.postMessage({
                            type: 'process-image-data',
                            imageNodeId: node.id,
                            imageBytes: bytes,
                            resizePercentage: resizePercentage,
                            quality: quality,
                            width: node.width,
                            height: node.height,
                            fileType: fileFormats[0]
                        });
                    } catch (e: any) {
                        figma.notify(`오류: 이미지 "${node.name || '알 수 없음'}"를 로드할 수 없습니다.`, { error: true });
                    }
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
                        newFills.push({ ...fill, imageHash: newImageHash });
                    } else {
                        newFills.push(fill);
                    }
                }
                (node as RectangleNode | EllipseNode | PolygonNode | StarNode | TextNode | VectorNode).fills = newFills;

                // ★★★ 변경: 각 이미지 완료 알림 제거 ★★★
                // figma.notify(`원본: ${formatBytes(originalSize)} → 최적화: ${formatBytes(optimizedBytes.byteLength)}`);

                // ★★★ 추가: 처리 완료된 이미지 개수 카운트 ★★★
                processedImageCount++;
                if (processedImageCount === totalImagesToProcess) {
                    // ★★★ 추가: 모든 이미지 처리가 완료되면 최종 알림 표시 ★★★
                    figma.notify('이미지 최적화가 완료되었습니다!');
                    totalImagesToProcess = 0; // 리셋
                    processedImageCount = 0; // 리셋
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
    const selectedNodes = figma.currentPage.selection;
    const imageNodes: ImageCapableNode[] = selectedNodes.filter(node =>
        'fills' in node && Array.isArray(node.fills) &&
        (node.fills as Paint[]).some(fill => fill.type === 'IMAGE' && fill.imageHash !== null) &&
        'width' in node && 'height' in node && node.width > 0 && node.height > 0
    ) as ImageCapableNode[];

    figma.ui.postMessage({ type: 'selection-change', selectedNodeCount: imageNodes.length });
    
    if (imageNodes.length > 0) {
        await sendAllImageDataToUI(imageNodes);
    } else {
        figma.ui.postMessage({ type: 'selection-image-data-batch', imagesData: [] });
    }
});