/**
 * 로그인/회원가입 카드 전환, 비밀번호 표시 토글, 폼 제출 처리. 실제 OAuth 연동 전 단계라 제출 시 그냥 홈으로 이동만 시키는 디자인 목업 단계 로직이다.
 *
 * Handles the login/register card switch, password-visibility toggle, and form submits. No real OAuth
 * yet — submitting either form just redirects to the home page (design mockup stage).
 */
import '../main.scss';
import '../utils/security.js';
import '../scss/pages/login.scss';

// DOM 로드 후 로그인 페이지의 모든 인터랙션(폼 전환/비밀번호 토글/제출)을 바인딩
document.addEventListener('DOMContentLoaded', function () {
  const loginCard = document.getElementById('loginCard');
  const registerCard = document.getElementById('registerCard');
  const showRegisterForm = document.getElementById('showRegisterForm');
  const showLoginForm = document.getElementById('showLoginForm');
  const togglePassword = document.getElementById('togglePassword');
  const passwordInput = document.getElementById('password');
  const eyeIcon = document.getElementById('eyeIcon');

  // Form switching
  showRegisterForm.addEventListener('click', function (e) {
    e.preventDefault();
    loginCard.classList.add('d-none');
    registerCard.classList.remove('d-none');
  });

  showLoginForm.addEventListener('click', function (e) {
    e.preventDefault();
    registerCard.classList.add('d-none');
    loginCard.classList.remove('d-none');
  });

  // Password toggle
  togglePassword.addEventListener('click', function () {
    const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
    passwordInput.setAttribute('type', type);
    eyeIcon.classList.toggle('fa-eye');
    eyeIcon.classList.toggle('fa-eye-slash');
  });

  // Form submissions (design only — no OAuth yet, just land on the home page)
  document.getElementById('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    window.location.href = 'index.html';
  });

  document.getElementById('registerForm').addEventListener('submit', function (e) {
    e.preventDefault();
    window.location.href = 'index.html';
  });
});
