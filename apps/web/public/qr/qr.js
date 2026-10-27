// Το κουμπί «Εκτύπωση / PDF». Σε δικό του αρχείο, γιατί το
// Content-Security-Policy (vercel.json) δεν επιτρέπει onclick μέσα στη σελίδα.

document.querySelector(".print").addEventListener("click", function () {
  window.print();
});
