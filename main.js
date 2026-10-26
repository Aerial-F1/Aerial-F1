const html = document.documentElement;
const AERIAL_USER_NAME_KEY = 'aerial_user_name';
const AERIAL_VISITOR_INTAKE_KEY = 'aerial_visitor_intake_complete';
const AERIAL_TERMS_ACCEPTED_KEY = 'aerial_terms_accepted';

function readStoredUserName() {
    try {
        return localStorage.getItem(AERIAL_USER_NAME_KEY) || '';
    } catch (error) {
        console.info('The saved user name is unavailable in this browser.', error);
        return '';
    }
}

function updateHeaderGreeting() {
    const greetingEl = document.getElementById('user-greeting');
    if (!greetingEl) return;
    const savedName = readStoredUserName();
    greetingEl.textContent = savedName ? `Welcome, ${savedName}` : '';
}

window.AerialUserSession = {
    getName: readStoredUserName,
    saveName(name) {
        const cleanName = name.trim();
        if (!cleanName) return false;
        try {
            localStorage.setItem(AERIAL_USER_NAME_KEY, cleanName);
            this.updateGreeting(cleanName);
            return true;
        } catch (error) {
            console.info('The user name could not be saved in this browser.', error);
            return false;
        }
    },
    hasCompletedIntake() {
        try {
            if (localStorage.getItem(AERIAL_VISITOR_INTAKE_KEY) === 'true') return true;
            const logs = JSON.parse(localStorage.getItem('aerial_visitor_logs') || '[]');
            return Array.isArray(logs) && logs.length > 0;
        } catch (error) {
            console.info('Visitor intake status is unavailable in this browser.', error);
            return false;
        }
    },
    markIntakeComplete() {
        try {
            localStorage.setItem(AERIAL_VISITOR_INTAKE_KEY, 'true');
            return true;
        } catch (error) {
            console.info('Visitor intake status could not be saved in this browser.', error);
            return false;
        }
    },
    hasAcceptedTerms() {
        try {
            if (localStorage.getItem(AERIAL_TERMS_ACCEPTED_KEY) === 'true') return true;
            const logs = JSON.parse(localStorage.getItem('aerial_terms_consent_logs') || '[]');
            return Array.isArray(logs) && logs.length > 0;
        } catch (error) {
            console.info('Saved terms consent is unavailable in this browser.', error);
            return false;
        }
    },
    markTermsAccepted(name) {
        this.saveName(name);
        try {
            localStorage.setItem(AERIAL_TERMS_ACCEPTED_KEY, 'true');
            return true;
        } catch (error) {
            console.info('Terms acceptance could not be saved in this browser.', error);
            return false;
        }
    },
    updateGreeting(name = readStoredUserName()) {
        updateHeaderGreeting();
        const mobileGreeting = document.getElementById('welcome-user-badge-mobile');
        if (mobileGreeting) {
            mobileGreeting.textContent = name ? `Welcome, ${name}` : '';
            mobileGreeting.classList.toggle('hidden', !name);
        }
    },
    fillNameFields() {
        const name = readStoredUserName();
        document.querySelectorAll('input[autocomplete="name"], input[name="full_name"]').forEach(input => {
            input.value = name;
        });
        this.updateGreeting(name);
    },
    scrollToHome() {
        document.documentElement.classList.add('force-top-scroll');
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
        window.requestAnimationFrame(() => {
            document.documentElement.classList.remove('force-top-scroll');
        });
    }
};

        let scene, camera, renderer, controls, carMesh;

        let threeDependenciesPromise = null;
        let viewerInitializationStarted = false;
        let visitorAccessLocked = true;
        let termsTransitionTimeout = null;
        let activeTermsFormId = null;
        let termsTriggerElement = null;

        function loadScript(src) {
            return new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = src;
                script.async = true;
                script.onload = resolve;
                script.onerror = () => reject(new Error(`Could not load ${src}`));
                document.head.appendChild(script);
            });
        }

        function loadThreeDependencies() {
            if (window.THREE && window.THREE.STLLoader && window.THREE.OrbitControls) return Promise.resolve();
            if (!threeDependenciesPromise) {
                threeDependenciesPromise = (async () => {
                    try {
                        if (!window.THREE) {
                            await loadScript('https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js');
                        }
                        if (!window.THREE.STLLoader) {
                            await loadScript('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/STLLoader.js');
                        }
                        if (!window.THREE.OrbitControls) {
                            await loadScript('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js');
                        }
                    } catch (error) {
                        threeDependenciesPromise = null;
                        throw error;
                    }
                })();
            }
            return threeDependenciesPromise;
        }

        function initLazy3DViewer() {
            const section = document.getElementById('car');
            if (!section) return;

            try {
                if (!('IntersectionObserver' in window)) {
                    window.setTimeout(init3DViewer, 1200);
                    return;
                }

                const observer = new IntersectionObserver((entries, currentObserver) => {
                    if (!entries.some(entry => entry.isIntersecting)) return;
                    currentObserver.disconnect();
                    init3DViewer();
                }, { rootMargin: '900px 0px' });
                observer.observe(section);
            } catch (error) {
                console.info('Lazy 3D loading is unavailable; initializing the viewer with fallback handling.', error);
                window.setTimeout(init3DViewer, 1200);
            }
        }

        function updateThemeUI(isDark) {
            const icon = document.getElementById('theme-toggle-icon');
            const iconMobile = document.getElementById('theme-toggle-icon-mobile');

            if (isDark) {
                html.classList.add('dark');
                if (icon) icon.className = 'fa-solid fa-sun text-yellow-400 text-lg';
                if (iconMobile) iconMobile.className = 'fa-solid fa-sun text-yellow-400 text-base';
            } else {
                html.classList.remove('dark');
                if (icon) icon.className = 'fa-solid fa-moon text-slate-700 text-lg';
                if (iconMobile) iconMobile.className = 'fa-solid fa-moon text-slate-700 text-base';
            }

            try {
                localStorage.setItem('theme', isDark ? 'dark' : 'light');
            } catch (error) {
                console.info('Theme preference could not be stored in this browser.', error);
            }

            if (carMesh) {
                carMesh.material.color.setHex(isDark ? 0x00E5FF : 0x00838F);
            }
        }

        let savedTheme = null;
        try {
            savedTheme = localStorage.getItem('theme');
        } catch (error) {
            console.info('Theme preference is unavailable; using the light theme.', error);
        }
        const initialDark = savedTheme === 'dark';
        updateThemeUI(initialDark);

        function toggleTheme() {
            const isDark = html.classList.contains('dark');
            updateThemeUI(!isDark);
        }

        window.addEventListener('DOMContentLoaded', () => {
            updateHeaderGreeting();
            window.AerialUserSession.updateGreeting();
            const themeBtn = document.getElementById('theme-toggle');
            const themeBtnMobile = document.getElementById('theme-toggle-mobile');
            if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
            if (themeBtnMobile) themeBtnMobile.addEventListener('click', toggleTheme);

            const mobileBtn = document.getElementById('mobile-menu-btn');
            const mobileMenu = document.getElementById('mobile-menu');
            if (mobileBtn && mobileMenu) {
                mobileBtn.addEventListener('click', () => {
                    const isOpening = mobileMenu.classList.contains('hidden');
                    mobileMenu.classList.toggle('hidden', !isOpening);
                    mobileBtn.setAttribute('aria-expanded', String(isOpening));
                    mobileBtn.setAttribute('aria-label', isOpening ? 'Close navigation menu' : 'Open navigation menu');
                });
                mobileMenu.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
                    mobileMenu.classList.add('hidden');
                    mobileBtn.setAttribute('aria-expanded', 'false');
                    mobileBtn.setAttribute('aria-label', 'Open navigation menu');
                }));
            }

            const returningVisitor = window.AerialUserSession.hasCompletedIntake();
            document.getElementById('visitor-modal').classList.toggle('hidden', returningVisitor);
            setVisitorAccessLocked(!returningVisitor);
            window.AerialUserSession.fillNameFields();
            window.AerialUserSession.scrollToHome();
            const termsNameInput = document.getElementById('terms-full-name');
            const termsCheckbox = document.getElementById('terms-accept-checkbox');
            const updateTermsAcceptButton = () => {
                const button = document.getElementById('terms-accept-button');
                button.disabled = !termsNameInput.value.trim() || !termsCheckbox.checked;
            };
            termsNameInput.addEventListener('input', () => {
                window.AerialUserSession.saveName(termsNameInput.value);
                updateTermsAcceptButton();
            });
            termsCheckbox.addEventListener('change', updateTermsAcceptButton);
            document.getElementById('terms-flow').addEventListener('click', event => {
                if (event.target === event.currentTarget) closeTermsFlow();
            });
            document.addEventListener('touchmove', event => {
                if (visitorAccessLocked
                    && (!(event.target instanceof Element) || !event.target.closest('#visitor-modal .modal-panel'))) {
                    event.preventDefault();
                }
            }, { passive: false });
            document.getElementById('navtej-card').addEventListener('click', trackNavtejCardClick);
            document.addEventListener('keydown', event => {
                if (visitorAccessLocked) {
                    if (event.key === 'Escape') {
                        event.preventDefault();
                        return;
                    }
                    if (event.key === 'Tab') {
                        const focusable = Array.from(document.getElementById('visitor-modal').querySelectorAll(
                            'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
                        ));
                        const first = focusable[0];
                        const last = focusable[focusable.length - 1];
                        if (event.shiftKey && document.activeElement === first) {
                            event.preventDefault();
                            last.focus();
                        } else if (!event.shiftKey && document.activeElement === last) {
                            event.preventDefault();
                            first.focus();
                        }
                    }
                    return;
                }
                if (!document.getElementById('terms-flow').classList.contains('hidden')) {
                    if (event.key === 'Escape') {
                        event.preventDefault();
                        closeTermsFlow();
                        return;
                    }
                    if (event.key === 'Tab') {
                        const focusable = Array.from(document.getElementById('terms-consent-stage').querySelectorAll(
                            'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
                        ));
                        const first = focusable[0];
                        const last = focusable[focusable.length - 1];
                        if (event.shiftKey && document.activeElement === first) {
                            event.preventDefault();
                            last.focus();
                        } else if (!event.shiftKey && document.activeElement === last) {
                            event.preventDefault();
                            first.focus();
                        }
                    }
                    return;
                }
                if (event.key !== 'Escape') return;
                closeAdminModal();
                closeSponsorModal();
                if (mobileMenu && mobileBtn) {
                    mobileMenu.classList.add('hidden');
                    mobileBtn.setAttribute('aria-expanded', 'false');
                }
            });

            initScrollAnimations();
        });

        window.addEventListener('pageshow', event => {
            if (!event.persisted) window.AerialUserSession.scrollToHome();
        });

        function setVisitorAccessLocked(locked) {
            const modal = document.getElementById('visitor-modal');
            visitorAccessLocked = locked;
            document.body.classList.toggle('modal-open', locked);
            Array.from(document.body.children).forEach(element => {
                if (element !== modal) element.inert = locked;
            });
            if (locked) document.getElementById('visitor-company').focus({ preventScroll: true });
        }

        function initScrollAnimations() {
            const elements = document.querySelectorAll('section:not(.terms-stage), .glass-black-card:not(.terms-stage)');
            const reducedMotion = typeof window.matchMedia === 'function'
                && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

            if (reducedMotion || !('IntersectionObserver' in window)) return;

            const observer = new IntersectionObserver(entries => {
                entries.forEach(entry => {
                    entry.target.classList.toggle('is-visible', entry.isIntersecting);
                });
            }, { threshold: 0.12 });

            elements.forEach(element => {
                element.classList.add('scroll-reveal');
                observer.observe(element);
            });
        }

        let currentTier = 'Title Partner';
        function openSponsorModal(tier) {
            currentTier = tier;
            document.getElementById('modal-tier-name').innerText = tier;
            document.getElementById('modal-subject').value = `Sponsorship Inquiry - ${tier}`;
            const modal = document.getElementById('sponsor-modal');
            modal.classList.remove('hidden', 'is-closed');
        }
        function closeSponsorModal() {
            const modal = document.getElementById('sponsor-modal');
            modal.classList.add('is-closed');
            window.setTimeout(() => {
                if (modal.classList.contains('is-closed')) modal.classList.add('hidden');
            }, 250);
        }

        function closeVisitorModal() {
            const modal = document.getElementById('visitor-modal');
            if (visitorAccessLocked || !modal || modal.classList.contains('is-closed')) return Promise.resolve();
            modal.classList.add('is-closed');
            return new Promise(resolve => window.setTimeout(() => {
                if (modal.classList.contains('is-closed')) modal.classList.add('hidden');
                resolve();
            }, 250));
        }

        function readVisitorLogs() {
            try {
                const logs = JSON.parse(localStorage.getItem('aerial_visitor_logs') || '[]');
                return Array.isArray(logs) ? logs.filter(entry => entry && typeof entry === 'object') : [];
            } catch (error) {
                console.info('Visitor logs could not be read from this browser.', error);
                return [];
            }
        }

        function saveVisitorLog(entry) {
            try {
                const logs = readVisitorLogs();
                logs.push(entry);
                localStorage.setItem('aerial_visitor_logs', JSON.stringify(logs));
                return true;
            } catch (error) {
                console.info('Visitor log could not be saved in this browser.', error);
                return false;
            }
        }

        function renderVisitorLogs() {
            const rows = document.getElementById('admin-log-rows');
            const status = document.getElementById('admin-log-status');
            rows.replaceChildren();
            const logs = readVisitorLogs();

            if (logs.length === 0) {
                const row = document.createElement('tr');
                const cell = document.createElement('td');
                cell.colSpan = 5;
                cell.className = 'p-4 text-center text-slate-500';
                cell.textContent = 'No visitor entries are stored in this browser.';
                row.appendChild(cell);
                rows.appendChild(row);
                status.textContent = 'No local visitor entries.';
                return;
            }

            logs.forEach(entry => {
                const row = document.createElement('tr');
                [entry.companyName, entry.email, entry.phone, entry.ip, entry.timestamp].forEach(value => {
                    const cell = document.createElement('td');
                    cell.className = 'break-words p-3 text-slate-700 dark:text-gray-200';
                    cell.textContent = typeof value === 'string' ? value : 'N/A';
                    row.appendChild(cell);
                });
                rows.appendChild(row);
            });
            status.textContent = `${logs.length} entr${logs.length === 1 ? 'y' : 'ies'} stored in this browser.`;
        }

        function openAdminModal() {
            const modal = document.getElementById('admin-modal');
            modal.classList.remove('hidden', 'is-closed');
            renderVisitorLogs();
        }

        function closeAdminModal() {
            const modal = document.getElementById('admin-modal');
            if (!modal || modal.classList.contains('hidden') || modal.classList.contains('is-closed')) return;
            modal.classList.add('is-closed');
            window.setTimeout(() => {
                if (modal.classList.contains('is-closed')) modal.classList.add('hidden');
            }, 250);
        }

        function clearVisitorLogs() {
            const status = document.getElementById('admin-log-status');
            try {
                localStorage.removeItem('aerial_visitor_logs');
                renderVisitorLogs();
                status.textContent = 'Visitor logs cleared from this browser.';
            } catch (error) {
                console.info('Visitor logs could not be cleared from this browser.', error);
                status.textContent = 'This browser does not allow its visitor logs to be cleared.';
            }
        }

        let navtejCardClicks = [];
        function trackNavtejCardClick() {
            const now = Date.now();
            navtejCardClicks = navtejCardClicks.filter(timestamp => now - timestamp <= 2000);
            navtejCardClicks.push(now);
            if (navtejCardClicks.length >= 5) {
                navtejCardClicks = [];
                openAdminModal();
            }
        }

        async function getVisitorIpAddress() {
            let controller = null;
            let timeoutId = null;
            try {
                if (typeof AbortController !== 'undefined') controller = new AbortController();
                const request = fetch(
                    'https://api.ipify.org?format=json',
                    controller ? { signal: controller.signal } : undefined
                ).then(async response => {
                    if (!response.ok) return 'N/A';
                    const result = await response.json();
                    return typeof result.ip === 'string' && result.ip ? result.ip : 'N/A';
                });
                const timeout = new Promise(resolve => {
                    timeoutId = window.setTimeout(() => {
                        if (controller) controller.abort();
                        resolve('N/A');
                    }, 3000);
                });
                return await Promise.race([request, timeout]);
            } catch (error) {
                return 'N/A';
            } finally {
                if (timeoutId !== null) window.clearTimeout(timeoutId);
            }
        }

        async function sendVisitorEntryToSheetDb(entry) {
            let controller = null;
            let timeoutId = null;
            try {
                if (typeof AbortController !== 'undefined') controller = new AbortController();
                const request = fetch('https://sheetdb.io/api/v1/5z3cumgln8560', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ data: entry }),
                    ...(controller ? { signal: controller.signal } : {})
                }).then(async response => {
                    const result = await response.json();
                    if (!response.ok || result.error) {
                        throw new Error(result.error || 'SheetDB submission failed.');
                    }
                });
                const timeout = new Promise((resolve, reject) => {
                    timeoutId = window.setTimeout(() => {
                        if (controller) controller.abort();
                        reject(new Error('SheetDB submission timed out.'));
                    }, 8000);
                });
                await Promise.race([request, timeout]);
            } finally {
                if (timeoutId !== null) window.clearTimeout(timeoutId);
            }
        }

        async function submitVisitorIntake(event) {
            event.preventDefault();
            const form = event.currentTarget;
            const button = document.getElementById('visitor-submit-btn');
            const status = document.getElementById('visitor-form-status');
            button.disabled = true;
            button.textContent = 'Submitting...';
            status.textContent = 'Preparing your submission...';

            const formData = new FormData(form);
            const companyName = String(formData.get('company_name') || '').trim();
            const email = String(formData.get('email') || '').trim();
            const phone = String(formData.get('phone') || '').trim();
            if (companyName.toLowerCase() === 'xxx') {
                setVisitorAccessLocked(false);
                form.reset();
                button.disabled = false;
                button.textContent = 'Send Company Details';
                status.textContent = '';
                await closeVisitorModal();
                window.alert('Hello Admin!');
                initLazy3DViewer();
                window.AerialUserSession.scrollToHome();
                return;
            }

            status.textContent = 'Looking up your IP address and saving your submission...';
            let savedLocally = false;
            let savedToSheet = false;
            let sheetError = null;
            try {
                const ip = await getVisitorIpAddress();
                const entry = {
                    companyName,
                    email: email || 'N/A',
                    phone: phone || 'N/A',
                    ip: ip || 'N/A',
                    timestamp: new Date().toLocaleString()
                };
                savedLocally = saveVisitorLog(entry);
                try {
                    await sendVisitorEntryToSheetDb(entry);
                    savedToSheet = true;
                } catch (error) {
                    sheetError = error;
                    console.warn('Visitor details could not be submitted to SheetDB.', error);
                }
            } finally {
                setVisitorAccessLocked(false);
                form.reset();
                button.disabled = false;
                button.textContent = 'Send Company Details';
                status.textContent = '';
                await closeVisitorModal();
                initLazy3DViewer();
                window.AerialUserSession.scrollToHome();
            }

            if (savedLocally || savedToSheet) window.AerialUserSession.markIntakeComplete();
            if (savedToSheet) {
                showSuccessToast('Thank you!', 'Your company details were sent to Aerial F1.');
            } else {
                showSuccessToast(
                    'Submission unavailable',
                    savedLocally
                        ? 'Your entry is saved in this browser, but could not be sent to SheetDB.'
                        : 'Your details could not be saved or sent. Please contact us by email.'
                );
                if (sheetError) console.info('The visitor can still browse because the local submission was attempted.', sheetError);
            }
        }

        function showSuccessToast(title = 'Message Sent Successfully!', message = 'We received your message and will get back to you soon.') {
            const toast = document.getElementById('success-toast');
            toast.querySelector('h4').textContent = title;
            toast.querySelector('p').textContent = message;
            toast.classList.remove('translate-y-32', 'opacity-0');
            setTimeout(() => {
                toast.classList.add('translate-y-32', 'opacity-0');
            }, 5000);
        }

        function startTermsFlow(formId) {
            const form = document.getElementById(formId);
            const flow = document.getElementById('terms-flow');
            if (!form || !flow) return;
            if (termsTransitionTimeout !== null) window.clearTimeout(termsTransitionTimeout);

            activeTermsFormId = formId;
            termsTriggerElement = document.activeElement;
            document.getElementById('terms-consent-form').reset();
            document.getElementById('terms-full-name').value = window.AerialUserSession.getName();
            document.getElementById('terms-accept-button').disabled = true;
            document.getElementById('terms-consent-status').textContent = '';
            document.body.classList.add('modal-open');
            Array.from(document.body.children).forEach(element => {
                element.inert = element !== flow;
            });
            flow.classList.remove('hidden');
            document.getElementById('terms-verification-stage').classList.remove('hidden', 'is-leaving');
            document.getElementById('terms-consent-stage').classList.add('hidden');
            document.getElementById('terms-verification-stage').focus({ preventScroll: true });
            termsTransitionTimeout = window.setTimeout(() => {
                const verification = document.getElementById('terms-verification-stage');
                verification.classList.add('is-leaving');
                termsTransitionTimeout = window.setTimeout(() => {
                    verification.classList.add('hidden');
                    verification.classList.remove('is-leaving');
                    document.getElementById('terms-consent-stage').classList.remove('hidden');
                    document.getElementById('terms-full-name').focus({ preventScroll: true });
                    termsTransitionTimeout = null;
                }, 220);
            }, 2000);
        }

        function closeTermsFlow() {
            if (termsTransitionTimeout !== null) {
                window.clearTimeout(termsTransitionTimeout);
                termsTransitionTimeout = null;
            }
            document.getElementById('terms-flow').classList.add('hidden');
            document.getElementById('terms-verification-stage').classList.remove('is-leaving');
            document.getElementById('terms-consent-stage').classList.add('hidden');
            document.body.classList.remove('modal-open');
            Array.from(document.body.children).forEach(element => {
                element.inert = false;
            });
            if (visitorAccessLocked) setVisitorAccessLocked(true);
            else window.AerialUserSession.scrollToHome();
            termsTriggerElement = null;
            activeTermsFormId = null;
        }

        function acceptTermsConsent(event) {
            event.preventDefault();
            const fullName = document.getElementById('terms-full-name').value.trim();
            const accepted = document.getElementById('terms-accept-checkbox').checked;
            const status = document.getElementById('terms-consent-status');
            if (!fullName || !accepted || !activeTermsFormId) return;

            try {
                const key = 'aerial_terms_consent_logs';
                const logs = JSON.parse(localStorage.getItem(key) || '[]');
                if (!Array.isArray(logs)) throw new Error('The local consent log has an invalid format.');
                logs.push({
                    fullName,
                    form: activeTermsFormId,
                    acceptedAt: new Date().toISOString(),
                    termsVersion: '2026-10-26'
                });
                localStorage.setItem(key, JSON.stringify(logs));
                const nameInput = document.getElementById('terms-full-name');
                const userName = nameInput.value.trim();
                if (userName) localStorage.setItem('aerial_user_name', userName);
                window.AerialUserSession.markTermsAccepted(fullName);
                updateHeaderGreeting();
            } catch (error) {
                console.warn('Terms consent could not be recorded in this browser.', error);
                status.textContent = 'Consent could not be recorded on this device. Enable local storage and try again.';
                return;
            }

            const form = document.getElementById(activeTermsFormId);
            if (form) form.dataset.termsAccepted = 'true';
            status.textContent = '';
            closeTermsFlow();
        }

        async function submitContactForm(e) {
            e.preventDefault();
            if (e.currentTarget.dataset.termsAccepted !== 'true') {
                if (window.AerialUserSession.hasAcceptedTerms()) {
                    e.currentTarget.dataset.termsAccepted = 'true';
                } else {
                    startTermsFlow(e.currentTarget.id);
                    return;
                }
            }
            const btn = document.getElementById('contact-submit-btn');
            btn.innerText = 'Sending...';
            btn.disabled = true;

            const formData = new FormData(e.target);
            try {
                const response = await fetch('https://api.web3forms.com/submit', {
                    method: 'POST',
                    body: formData
                });
                const data = await response.json();
                if (!response.ok || !data.success) throw new Error(data.message || 'The inquiry could not be sent.');
                e.target.reset();
                showSuccessToast();
            } catch (error) {
                console.error('Contact inquiry submission failed.', error);
                showSuccessToast('Could not send inquiry', 'Please try again or email aerialteam.f1@gmail.com.');
            } finally {
                btn.innerText = 'Send Inquiry';
                btn.disabled = false;
            }
        }

        async function submitModalForm(e) {
            e.preventDefault();
            if (e.currentTarget.dataset.termsAccepted !== 'true') {
                if (window.AerialUserSession.hasAcceptedTerms()) {
                    e.currentTarget.dataset.termsAccepted = 'true';
                } else {
                    startTermsFlow(e.currentTarget.id);
                    return;
                }
            }
            const btn = document.getElementById('modal-submit-btn');
            btn.innerText = 'Sending...';
            btn.disabled = true;

            const formData = new FormData(e.target);
            try {
                const response = await fetch('https://api.web3forms.com/submit', {
                    method: 'POST',
                    body: formData
                });
                const data = await response.json();
                if (!response.ok || !data.success) throw new Error(data.message || 'The sponsorship inquiry could not be sent.');
                e.target.reset();
                closeSponsorModal();
                showSuccessToast();
            } catch (error) {
                console.error('Sponsorship inquiry submission failed.', error);
                showSuccessToast('Could not send inquiry', 'Please try again or email aerialteam.f1@gmail.com.');
            } finally {
                btn.innerText = 'Submit Inquiry';
                btn.disabled = false;
            }
        }

        // --- THREE.JS 3D STL VIEWER ---
        async function loadCarGeometry() {
            try {
                if (typeof DecompressionStream !== 'function') throw new Error('Gzip decompression is not supported.');
                const response = await fetch('car.stl.gz');
                if (!response.ok) throw new Error(`Could not load compressed model (${response.status})`);
                const compressed = await response.arrayBuffer();
                const decompressed = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
                return new THREE.STLLoader().parse(await new Response(decompressed).arrayBuffer());
            } catch (error) {
                console.info('Compressed car model unavailable; loading the standard STL.', error);
            }

            return new Promise((resolve, reject) => {
                new THREE.STLLoader().load('car.stl', resolve, undefined, reject);
            });
        }

        async function init3DViewer() {
            if (viewerInitializationStarted) return;
            viewerInitializationStarted = true;
            const container = document.getElementById('viewer-container');
            if (!container) return;

            const status = document.getElementById('viewer-status');
            const spinner = document.getElementById('loading-spinner');
            if (status) status.innerText = 'Loading 3D viewer...';

            try {
                await loadThreeDependencies();
                scene = new THREE.Scene();
                camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);

                renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'low-power' });
                renderer.setSize(container.clientWidth, container.clientHeight);
                renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
                container.appendChild(renderer.domElement);

                controls = new THREE.OrbitControls(camera, renderer.domElement);
                controls.enableDamping = true;
                controls.dampingFactor = 0.05;
                controls.enablePan = false;

                const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
                scene.add(ambientLight);

                const dirLight1 = new THREE.DirectionalLight(0x00E5FF, 1.2);
                dirLight1.position.set(1, 2, 1).normalize();
                scene.add(dirLight1);

                const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.8);
                dirLight2.position.set(-1, -1, -1).normalize();
                scene.add(dirLight2);

                window.addEventListener('resize', () => {
                    camera.aspect = container.clientWidth / container.clientHeight;
                    camera.updateProjectionMatrix();
                    renderer.setSize(container.clientWidth, container.clientHeight);
                });

                const geometry = await loadCarGeometry();
                geometry.computeVertexNormals();

                const isDark = html.classList.contains('dark');
                const material = new THREE.MeshStandardMaterial({
                    color: isDark ? 0x00E5FF : 0x00838F,
                    metalness: 0.3,
                    roughness: 0.3,
                    side: THREE.DoubleSide
                });

                carMesh = new THREE.Mesh(geometry, material);
                carMesh.rotation.x = -Math.PI / 2;

                const group = new THREE.Group();
                group.add(carMesh);
                scene.add(group);

                const bounds = new THREE.Box3().setFromObject(group);
                const center = bounds.getCenter(new THREE.Vector3());
                group.position.sub(center);

                const size = new THREE.Vector3();
                bounds.getSize(size);
                const maxDim = Math.max(size.x, size.y, size.z);
                camera.position.set(maxDim * 1.8, maxDim * 1.2, maxDim * 1.8);
                controls.target.set(0, 0, 0);
                camera.lookAt(0, 0, 0);
                controls.update();

                if (spinner) spinner.classList.add('hidden');
                if (status) status.innerText = 'Car model loaded';

                function animate() {
                    requestAnimationFrame(animate);
                    controls.update();
                    renderer.render(scene, camera);
                }
                animate();
            } catch (error) {
                showViewerUnavailable(error);
            }
        }

        function showViewerUnavailable(error) {
            console.info('3D viewer is unavailable; the rest of the page remains usable.', error);
            const spinner = document.getElementById('loading-spinner');
            const status = document.getElementById('viewer-status');
            if (spinner) spinner.classList.add('hidden');
            if (status) status.innerText = '3D viewer unavailable on this device';
        }
