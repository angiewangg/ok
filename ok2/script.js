const navLinks = document.querySelectorAll('.site-nav a');

navLinks.forEach((link) => {
  link.addEventListener('click', (event) => {
    const targetId = link.getAttribute('href');
    if (targetId && targetId.startsWith('#')) {
      event.preventDefault();
      document.querySelector(targetId)?.scrollIntoView({ behavior: 'smooth' });
    }
  });
});
