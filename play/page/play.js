document.addEventListener('DOMContentLoaded', () => {
  const gameBoard = document.getElementById('game-board');

  // Add some cards to the game board
  for (let i = 1; i <= 5; i++) {
    const cardContainer = document.createElement('div');
    cardContainer.innerHTML = `
      <div class="card" data-value="${i}">
        <span>${i}</span>
      </div>
    `;
    gameBoard.appendChild(cardContainer.firstElementChild);
  }

  // Re-initialize card event listeners after adding them to the DOM
  initializeCards();
});
