document.addEventListener('DOMContentLoaded', () => {
    const startButton = document.getElementById('start-button');
    if (startButton) {
        startButton.addEventListener('click', () => {
            const selectedLevel = document.querySelector('input[name="game-level"]:checked').value;
            const selectedRule = document.querySelector('input[name="rules"]:checked').value;
            // play.htmlにモード情報を引き継いで画面遷移
            window.location.href = `../../play/page/play.html?level=${selectedLevel}&rule=${selectedRule}`;
        });
    }
});
