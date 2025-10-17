function initializeCards() {
  const cards = document.querySelectorAll('.card');
  cards.forEach(card => {
    card.addEventListener('click', () => {
      const isAlreadySelected = card.classList.contains('selected');

      // Deselect all cards first
      cards.forEach(c => c.classList.remove('selected'));

      // If the card was not already selected, select it
      if (!isAlreadySelected) {
        card.classList.add('selected');
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
