document.addEventListener('DOMContentLoaded', () => {
  const numberBoard = document.getElementById('hand-number-board');
  const operatorBoard = document.getElementById('hand-operator-board');

  // Define the list of operators
  const operators = ['+', '-', '×', '÷'];

  // Add number cards to the number board
  for (let i = 1; i <= 5; i++) {
    const cardContainer = document.createElement('div');
    cardContainer.innerHTML = `
      <div class="card card-number" data-value="${i}">
        <span>${i}</span>
      </div>
    `;
    numberBoard.appendChild(cardContainer.firstElementChild);
  }

  // Add operator cards to the operator board
  operators.forEach(op => {
    const cardContainer = document.createElement('div');
    cardContainer.innerHTML = `
      <div class="card card-operator" data-value="${op}">
        <span>${op}</span>
      </div>
    `;
    operatorBoard.appendChild(cardContainer.firstElementChild);
  });

  // Initialize event listeners for all cards (numbers and operators)
  initializeCards();
});
