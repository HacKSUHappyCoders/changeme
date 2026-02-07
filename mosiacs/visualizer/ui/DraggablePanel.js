/**
 * makeDraggable — adds mouse-drag behavior to any panel via a handle element.
 *
 * On first drag, converts CSS-anchored positioning (bottom/right) to
 * fixed with explicit left/top so the panel moves freely.
 */
function makeDraggable(panel, handleEl) {
    if (!panel || !handleEl) return;

    handleEl.style.cursor = 'grab';
    handleEl.style.userSelect = 'none';

    let isDragging = false;
    let startX, startY, startLeft, startTop;

    handleEl.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('button')) return;

        isDragging = true;
        handleEl.style.cursor = 'grabbing';

        const rect = panel.getBoundingClientRect();
        startX = e.clientX;
        startY = e.clientY;
        startLeft = rect.left;
        startTop = rect.top;

        panel.style.position = 'fixed';
        panel.style.left = startLeft + 'px';
        panel.style.top = startTop + 'px';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';

        e.preventDefault();
        handleEl.setPointerCapture(e.pointerId);
    });

    handleEl.addEventListener('pointermove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        panel.style.left = (startLeft + dx) + 'px';
        panel.style.top = (startTop + dy) + 'px';
    });

    handleEl.addEventListener('pointerup', (e) => {
        if (!isDragging) return;
        isDragging = false;
        handleEl.style.cursor = 'grab';
        handleEl.releasePointerCapture(e.pointerId);
    });
}
