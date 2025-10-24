document.addEventListener('DOMContentLoaded', () => {
    const startButton = document.getElementById('start-button');
    if (startButton) {
        startButton.addEventListener('click', () => {
            const selectedMode = document.querySelector('input[name="game-mode"]:checked').value;
            // play.htmlにモード情報を引き継いで画面遷移
            window.location.href = `../../play/page/play.html?mode=${selectedMode}`;
        });
    }
});
