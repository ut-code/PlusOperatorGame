function initializeCards() {
  const cards = document.querySelectorAll('.card');
  cards.forEach(card => {
    card.addEventListener('click', () => {
      card.classList.toggle('selected');
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
