function initializeCards() {
  const cards = document.querySelectorAll('.card');

  cards.forEach(card => {
    card.addEventListener('click', () => {
      const isAlreadySelected = card.classList.contains('selected');
      const isNumber = card.classList.contains('card-number');
      const isOperator = card.classList.contains('card-operator');

      let groupSelector = null;
      if (isNumber) {
        groupSelector = '.card-number';
      } else if (isOperator) {
        groupSelector = '.card-operator';
      }

      // If the card belongs to a group, handle single selection within that group
      if (groupSelector) {
        // Deselect all cards in the same group
        document.querySelectorAll(groupSelector).forEach(c => {
          c.classList.remove('selected');
        });

        // If the clicked card was not already selected, select it.
        // This makes it the only selected one in its group.
        if (!isAlreadySelected) {
          card.classList.add('selected');
        }
      }
    });
  });
}

// If the component is loaded dynamically, you might need to call this function manually.
// For static loading, you can use DOMContentLoaded.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeCards);
} else {
  initializeCards();
}
