/* ==========================================================================
   APP STATE
   ========================================================================== */
const state = {
    shippingType: 'normal',
    shippingCost: 10.00,
    totalCost: 10.00,
    paymentMethod: 'pix',
    donor: {
        name: '',
        email: '',
        phone: '',
        cpf: '24823194047', // Default mathematically valid CPF to bypass Mercado Pago requirements without asking client
        cep: '',
        street: '',
        number: '',
        complement: '',
        neighborhood: '',
        city: '',
        state: '',
        size: 'M'
    }
};

/* ==========================================================================
   INITIALIZATION
   ========================================================================== */
let mp;

document.addEventListener('DOMContentLoaded', () => {
    // Initialize Mercado Pago with the Public Key
    try {
        mp = new MercadoPago('APP_USR-6ef31b59-8d0c-4e29-97bd-d3b544dd91b2', {
            locale: 'pt-BR'
        });
    } catch (e) {
        console.error("Mercado Pago SDK failed to load:", e);
    }

    initCarousel();
    // initNotifications();
    


    // Format CEP Input as typing
    const cepInput = document.getElementById('input-cep');
    cepInput.addEventListener('input', (e) => {
        let value = e.target.value.replace(/\D/g, '');
        if (value.length > 8) value = value.substring(0, 8);
        if (value.length > 5) {
            value = value.replace(/^(\d{5})(\d{1,3})$/, '$1-$2');
        }
        e.target.value = value;
    });

    // Format Credit Card Number Input (add spaces every 4 digits)
    const cardNumInput = document.getElementById('input-card-number');
    if (cardNumInput) {
        cardNumInput.addEventListener('input', (e) => {
            let value = e.target.value.replace(/\D/g, '');
            if (value.length > 16) value = value.substring(0, 16);
            
            // Format: 0000 0000 0000 0000
            let formatted = value.match(/.{1,4}/g);
            e.target.value = formatted ? formatted.join(' ') : '';
        });
    }

    // Format Card Expiration Input (MM/AA)
    const cardExpInput = document.getElementById('input-card-expiration');
    if (cardExpInput) {
        cardExpInput.addEventListener('input', (e) => {
            let value = e.target.value.replace(/\D/g, '');
            if (value.length > 4) value = value.substring(0, 4);
            
            if (value.length > 2) {
                e.target.value = value.substring(0, 2) + '/' + value.substring(2);
            } else {
                e.target.value = value;
            }
        });
    }

    // Format Card CVV Input (digits only, limit 4)
    const cardCvvInput = document.getElementById('input-card-cvv');
    if (cardCvvInput) {
        cardCvvInput.addEventListener('input', (e) => {
            let value = e.target.value.replace(/\D/g, '');
            if (value.length > 4) value = value.substring(0, 4);
            e.target.value = value;
        });
    }
});

/* ==========================================================================
   PRODUCT IMAGE GALLERY (CAROUSEL)
   ========================================================================== */
let activeSlideIndex = 0;

function initCarousel() {
    const track = document.getElementById('carousel-track');
    const slides = document.querySelectorAll('.carousel-slide');
    const dotsContainer = document.getElementById('carousel-dots');
    const prevBtn = document.getElementById('carousel-prev');
    const nextBtn = document.getElementById('carousel-next');
    
    if (!slides.length) return;

    // Generate dots
    slides.forEach((_, index) => {
        const dot = document.createElement('span');
        dot.className = index === 0 ? 'carousel-dot active' : 'carousel-dot';
        dot.addEventListener('click', () => goToSlide(index));
        dotsContainer.appendChild(dot);
    });

    const updateSlidePosition = () => {
        track.style.transform = `translateX(-${activeSlideIndex * 100}%)`;
        
        // Update dots
        const dots = document.querySelectorAll('.carousel-dot');
        dots.forEach((dot, idx) => {
            dot.classList.toggle('active', idx === activeSlideIndex);
        });
    };

    const goToSlide = (index) => {
        activeSlideIndex = index;
        updateSlidePosition();
    };

    prevBtn.addEventListener('click', () => {
        activeSlideIndex = (activeSlideIndex === 0) ? slides.length - 1 : activeSlideIndex - 1;
        updateSlidePosition();
    });

    nextBtn.addEventListener('click', () => {
        activeSlideIndex = (activeSlideIndex === slides.length - 1) ? 0 : activeSlideIndex + 1;
        updateSlidePosition();
    });
}

/* ==========================================================================
   ACCORDION ACTION
   ========================================================================== */
const app = {
    selectSize(size, element) {
        state.donor.size = size;
        
        // Remove active class from other size buttons
        const buttons = document.querySelectorAll('.size-btn');
        buttons.forEach(btn => {
            btn.classList.remove('active');
        });
        element.classList.add('active');

        // Sync to summary views
        const checkoutSizeDisp = document.getElementById('checkoutDisplaySize');
        if (checkoutSizeDisp) checkoutSizeDisp.textContent = size;

        const successSizeDisp = document.getElementById('successDisplaySize');
        if (successSizeDisp) successSizeDisp.textContent = size;
    },

    toggleAccordion(headerButton) {
        const item = headerButton.parentElement;
        const content = headerButton.nextElementSibling;
        const isActive = item.classList.contains('active');
        
        // Close all other accordions
        document.querySelectorAll('.accordion-item').forEach(acc => {
            acc.classList.remove('active');
            acc.querySelector('.accordion-content').style.maxHeight = null;
        });
        
        if (!isActive) {
            item.classList.add('active');
            content.style.maxHeight = content.scrollHeight + 'px';
        }
    },

    switchView(fromId, toId) {
        const fromView = document.getElementById(fromId);
        const toView = document.getElementById(toId);
        
        if (fromView) {
            fromView.classList.remove('active');
        }
        if (toView) {
            toView.classList.add('active');
            
            const scrollableChild = toView.querySelector('.product-content, .checkout-content, .success-screen-content');
            if (scrollableChild) {
                scrollableChild.scrollTop = 0;
                scrollableChild.style.overflowY = 'hidden';
                setTimeout(() => {
                    scrollableChild.style.overflowY = 'auto';
                }, 15);
            }
        }
    },

    /* ==========================================================================
       CHECKOUT VIEW NAVIGATION
       ========================================================================== */
    openCheckout() {
        this.switchView('view-product', 'view-checkout');
        if (window.fbq) fbq('track', 'InitiateCheckout');
    },

    closeCheckout() {
        this.switchView('view-checkout', 'view-product');
    },

    goToCheckoutStep3() {
        this.switchView('view-success', 'view-checkout');
        this.goToStep(3);
    },

    goToStep(step) {
        // Adjust step indicator header UI
        const indicators = document.querySelectorAll('.step-indicator');
        indicators.forEach((indicator, index) => {
            if (index + 1 === step) {
                indicator.className = 'step-indicator active';
            } else if (index + 1 < step) {
                indicator.className = 'step-indicator completed';
            } else {
                indicator.className = 'step-indicator';
            }
        });

        // Hide other step views, show requested step view
        document.getElementById('step-form-1').classList.toggle('active', step === 1);
        document.getElementById('step-form-2').classList.toggle('active', step === 2);
        document.getElementById('step-form-3').classList.toggle('active', step === 3);
        
        const checkoutView = document.getElementById('view-checkout');
        if (checkoutView) checkoutView.scrollTop = 0;
    },

    prevStep(step) {
        this.goToStep(step);
    },

    nextStep(currentStep, event) {
        event.preventDefault();
        
        if (currentStep === 1) {
            // STEP 1 VALIDATION
            const nameInput = document.getElementById('input-name');
            const emailInput = document.getElementById('input-email');
            const phoneInput = document.getElementById('input-phone');

            let isValid = true;

            // Name validation (at least first and last name)
            const nameVal = nameInput.value.trim();
            if (nameVal.split(' ').length < 2) {
                this.setInputError(nameInput, 'error-name', true);
                isValid = false;
            } else {
                this.setInputError(nameInput, 'error-name', false);
            }

            // Email validation
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(emailInput.value.trim())) {
                this.setInputError(emailInput, 'error-email', true);
                isValid = false;
            } else {
                this.setInputError(emailInput, 'error-email', false);
            }

            // Phone validation
            const phoneVal = phoneInput.value.replace(/\D/g, '');
            if (phoneVal.length < 10) {
                this.setInputError(phoneInput, 'error-phone', true);
                isValid = false;
            } else {
                this.setInputError(phoneInput, 'error-phone', false);
            }

            if (isValid) {
                state.donor.name = nameVal;
                state.donor.email = emailInput.value.trim();
                state.donor.phone = phoneInput.value.trim();
                
                this.goToStep(2);
                if (window.fbq) fbq('track', 'AddPaymentInfo');
            }
        } else if (currentStep === 2) {
            // STEP 2 VALIDATION
            const cepInput = document.getElementById('input-cep');
            const streetInput = document.getElementById('input-street');
            const numberInput = document.getElementById('input-number');
            const neighborhoodInput = document.getElementById('input-neighborhood');

            let isValid = true;

            if (cepInput.value.replace(/\D/g, '').length !== 8) {
                this.setInputError(cepInput, 'error-cep', true);
                isValid = false;
            } else {
                this.setInputError(cepInput, 'error-cep', false);
            }

            if (!streetInput.value.trim()) {
                streetInput.parentElement.classList.add('has-error');
                isValid = false;
            } else {
                streetInput.parentElement.classList.remove('has-error');
            }

            if (!numberInput.value.trim()) {
                numberInput.parentElement.classList.add('has-error');
                isValid = false;
            } else {
                numberInput.parentElement.classList.remove('has-error');
            }

            if (!neighborhoodInput.value.trim()) {
                neighborhoodInput.parentElement.classList.add('has-error');
                isValid = false;
            } else {
                neighborhoodInput.parentElement.classList.remove('has-error');
            }

            if (isValid) {
                state.donor.cep = cepInput.value.trim();
                state.donor.street = streetInput.value.trim();
                state.donor.number = numberInput.value.trim();
                state.donor.complement = document.getElementById('input-complement').value.trim();
                state.donor.neighborhood = neighborhoodInput.value.trim();
                state.donor.city = document.getElementById('input-city').value;
                state.donor.state = document.getElementById('input-state').value;

                // Sync pricing variables
                this.updateShippingDetailsBox();
                this.goToStep(3);
            }
        }
    },

    setInputError(inputElement, errorId, hasError) {
        const group = inputElement.parentElement;
        if (hasError) {
            group.classList.add('has-error');
        } else {
            group.classList.remove('has-error');
        }
    },

    /* CEP ViaCEP API Autocomplete */
    fetchAddress(cep) {
        const cleanedCep = cep.replace(/\D/g, '');
        if (cleanedCep.length !== 8) return;

        const loader = document.getElementById('cep-loading');
        loader.style.display = 'block';

        fetch(`https://viacep.com.br/ws/${cleanedCep}/json/`)
            .then(res => res.json())
            .then(data => {
                const cepInput = document.getElementById('input-cep');
                if (data.erro) {
                    this.setInputError(cepInput, 'error-cep', true);
                    this.clearAddressInputs();
                } else {
                    this.setInputError(cepInput, 'error-cep', false);
                    document.getElementById('input-street').value = data.logradouro || '';
                    document.getElementById('input-neighborhood').value = data.bairro || '';
                    document.getElementById('input-city').value = data.localidade || '';
                    document.getElementById('input-state').value = data.uf || '';
                    
                    // Focus on number input
                    document.getElementById('input-number').focus();
                }
            })
            .catch(() => {
                const cepInput = document.getElementById('input-cep');
                this.setInputError(cepInput, 'error-cep', true);
            })
            .finally(() => {
                loader.style.display = 'none';
            });
    },

    clearAddressInputs() {
        document.getElementById('input-street').value = '';
        document.getElementById('input-neighborhood').value = '';
        document.getElementById('input-city').value = '';
        document.getElementById('input-state').value = '';
    },

    /* Dynamic Shipping updates */
    updateShipping(cost, type) {
        state.shippingCost = cost;
        state.shippingType = type;
        state.totalCost = cost; // product is 0, so total is just donation

        // Adjust active shipping cards styles
        const normalCard = document.getElementById('label-shipping-normal');
        const sedexCard = document.getElementById('label-shipping-sedex');
        const testCard = document.getElementById('label-shipping-test');
        const benfeitorCard = document.getElementById('label-shipping-benfeitor');

        if (normalCard) normalCard.classList.toggle('active', type === 'normal');
        if (sedexCard) sedexCard.classList.toggle('active', type === 'sedex');
        if (testCard) testCard.classList.toggle('active', type === 'test');
        if (benfeitorCard) benfeitorCard.classList.toggle('active', type === 'benfeitor');

        this.updateShippingDetailsBox();
    },

    updateShippingDetailsBox() {
        let typeText = 'Doação Devoto (Frete Grátis)';
        if (state.shippingType === 'sedex') {
            typeText = 'Doação Protetor (Frete Grátis)';
        } else if (state.shippingType === 'test') {
            typeText = 'Doação Padrinho (Frete Grátis)';
        } else if (state.shippingType === 'benfeitor') {
            typeText = 'Doação Benfeitor (Frete Grátis)';
        }
        const costText = state.shippingCost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        
        document.getElementById('checkoutDisplayShippingType').textContent = typeText;
        document.getElementById('checkoutDisplayShippingCost').textContent = costText;
        document.getElementById('checkoutDisplayTotal').textContent = costText;
    },

    /* ==========================================================================
       PAYMENT TABS ACTIONS
       ========================================================================== */
    switchPaymentTab(method) {
        state.paymentMethod = method;
        
        const tabPix = document.getElementById('tab-pix');
        const tabCard = document.getElementById('tab-card');
        
        const subformPix = document.getElementById('subform-pix');
        const subformCard = document.getElementById('subform-card');

        if (method === 'pix') {
            tabPix.classList.add('active');
            tabCard.classList.remove('active');
            subformPix.classList.add('active');
            subformCard.classList.remove('active');
        } else {
            tabPix.classList.remove('active');
            tabCard.classList.add('active');
            subformPix.classList.remove('active');
            subformCard.classList.add('active');
            
            // Sync card button label amount
            const cardAmt = document.getElementById('btnCardPayAmount');
            if (cardAmt) {
                cardAmt.textContent = state.shippingCost.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            }
            
            // Update installments options dropdown
            this.updateCardInstallmentsDropdown();
        }
    },

    updateCardInstallmentsDropdown() {
        const select = document.getElementById('input-card-installments');
        if (!select) return;
        
        select.innerHTML = '';
        
        // Setup static elegant installment calculations up to 3x sem juros
        const amt = state.shippingCost;
        const options = [
            { val: 1, text: `1x de R$ ${amt.toFixed(2).replace('.', ',')} sem juros` },
            { val: 2, text: `2x de R$ ${(amt / 2).toFixed(2).replace('.', ',')} sem juros` },
            { val: 3, text: `3x de R$ ${(amt / 3).toFixed(2).replace('.', ',')} sem juros` }
        ];
        
        options.forEach(opt => {
            const el = document.createElement('option');
            el.value = opt.val;
            el.textContent = opt.text;
            select.appendChild(el);
        });
    },

    /* Handle PIX Payment with Vercel Serverless Function */
    processPixPayment() {
        // Show loader spinner
        const loader = document.getElementById('payment-loader');
        loader.style.display = 'flex';

        const payload = {
            payment_method_id: 'pix',
            transaction_amount: state.shippingCost,
            payer: {
                email: state.donor.email,
                first_name: state.donor.name.split(' ')[0],
                last_name: state.donor.name.split(' ').slice(1).join(' ') || 'Devoto',
                phone: state.donor.phone,
                identification: {
                    type: 'CPF',
                    number: state.donor.cpf.replace(/\D/g, '')
                }
            }
        };

        // Post to our serverless endpoint
        fetch('/api/create-payment', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        })
        .then(res => {
            if (!res.ok) {
                return res.json().then(err => { throw new Error(err.message || 'Erro ao processar PIX') });
            }
            return res.json();
        })
        .then(data => {
            loader.style.display = 'none';
            
            // Trigger purchase event immediately on PIX generation!
            if (window.fbq) fbq('track', 'Purchase', { value: state.shippingCost, currency: 'BRL' });

            // Set paymentMethod state
            state.paymentMethod = 'pix';
            
            // Populate success details
            document.getElementById('successDonorName').textContent = state.donor.name;
            document.getElementById('successDisplaySize').textContent = state.donor.size;
            let successShippingText = 'Doação Devoto (Frete Grátis)';
            if (state.shippingType === 'sedex') {
                successShippingText = 'Doação Protetor (Frete Grátis)';
            } else if (state.shippingType === 'test') {
                successShippingText = 'Doação Padrinho (Frete Grátis)';
            } else if (state.shippingType === 'benfeitor') {
                successShippingText = 'Doação Benfeitor (Frete Grátis)';
            }
            document.getElementById('successShippingType').textContent = successShippingText;
            document.getElementById('successTotalPaid').textContent = state.shippingCost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            document.getElementById('successMethodText').textContent = 'PIX';
            
            const fullAddress = `${state.donor.street}, Nº ${state.donor.number} ${state.donor.complement ? '- ' + state.donor.complement : ''}, ${state.donor.neighborhood}, ${state.donor.city}/${state.donor.state}`;
            document.getElementById('successAddressText').textContent = fullAddress;
            
            // Generate random order ID
            document.getElementById('success-order-id').textContent = `#SR-${Math.floor(Math.random() * 900000 + 100000)}-BR`;

            // Reset view-success headers for waiting status
            document.getElementById('success-status-icon').className = 'success-circle waiting';
            document.getElementById('success-status-icon').innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>';
            document.getElementById('success-status-title').textContent = 'Aguardando Pagamento';
            document.getElementById('success-status-desc').textContent = 'O envio do seu brinde será processado imediatamente após a confirmação do pagamento da taxa postal.';

            // Reset Timeline steps
            document.getElementById('timeline-step-1').className = 'timeline-item active';
            document.getElementById('timeline-step-1-desc').textContent = 'Aguardando confirmação do pagamento da taxa de envio.';
            document.getElementById('timeline-step-2').className = 'timeline-item pending';
            document.getElementById('timeline-step-3').className = 'timeline-item pending';
            
            // Show PIX box inside view-success
            document.getElementById('success-pix-container').style.display = 'block';

            // Populate Real QR Code base64 image and text copy key from Mercado Pago!
            const qrCodeBase64 = data.point_of_interaction.transaction_data.qr_code_base64;
            const qrCodeText = data.point_of_interaction.transaction_data.qr_code;
            
            document.getElementById('success-pix-qr').src = `data:image/jpeg;base64,${qrCodeBase64}`;
            document.getElementById('success-pix-code').value = qrCodeText;
            
            // Navigate to success view
            this.switchView('view-checkout', 'view-success');

            // Reset status checker container to waiting state
            const statusCard = document.getElementById('pix-status-card');
            if (statusCard) {
                statusCard.style.background = 'rgba(212, 175, 55, 0.06)';
                statusCard.style.borderColor = 'rgba(212, 175, 55, 0.4)';
            }
            document.getElementById('success-pix-status-label').textContent = 'Aguardando confirmação do pagamento...';
            document.getElementById('pix-status-loader').style.display = 'block';

            // Start polling and countdown
            this.startPixCountdown(15 * 60);
            this.startPixPolling(data.id);
        })
        .catch(err => {
            loader.style.display = 'none';
            alert(`Falha no Pagamento PIX: ${err.message || 'Tente novamente.'}`);
        });
    },

    /* Handle Credit Card Tokenization & Payment with Mercado Pago and Vercel */
    async processCardPayment() {
        const cardNumInput = document.getElementById('input-card-number');
        const expInput = document.getElementById('input-card-expiration');
        const cvvInput = document.getElementById('input-card-cvv');
        const cardholderInput = document.getElementById('input-card-name');
        const installmentSelect = document.getElementById('input-card-installments');

        let isValid = true;

        // Validations
        if (cardNumInput.value.replace(/\s/g, '').length < 15) {
            this.setInputError(cardNumInput, 'error-card-number', true);
            isValid = false;
        } else {
            this.setInputError(cardNumInput, 'error-card-number', false);
        }

        if (!expInput.value.includes('/') || expInput.value.length < 5) {
            this.setInputError(expInput, 'error-card-expiration', true);
            isValid = false;
        } else {
            this.setInputError(expInput, 'error-card-expiration', false);
        }

        if (cvvInput.value.length < 3) {
            this.setInputError(cvvInput, 'error-card-cvv', true);
            isValid = false;
        } else {
            this.setInputError(cvvInput, 'error-card-cvv', false);
        }

        if (cardholderInput.value.trim().split(' ').length < 2) {
            this.setInputError(cardholderInput, 'error-card-name', true);
            isValid = false;
        } else {
            this.setInputError(cardholderInput, 'error-card-name', false);
        }

        if (!isValid) return;

        // Show loader spinner
        const loader = document.getElementById('payment-loader');
        loader.style.display = 'flex';

        try {
            const [expMonth, expYear] = expInput.value.split('/');
            
            // 1. Create secure Card Token via Mercado Pago SDK
            const cardTokenResponse = await mp.createCardToken({
                cardNumber: cardNumInput.value.replace(/\s/g, ''),
                cardholderName: cardholderInput.value.trim(),
                cardExpirationMonth: expMonth,
                cardExpirationYear: '20' + expYear,
                securityCode: cvvInput.value,
                identificationType: 'CPF',
                identificationNumber: state.donor.cpf.replace(/\D/g, '')
            });

            // 2. Identify Card Brand (Visa, Mastercard, etc.)
            let cardBrand = 'master'; // fallback
            const firstBin = cardNumInput.value.replace(/\s/g, '').substring(0, 6);
            
            // Simple BIN-based brand resolver
            if (firstBin.startsWith('4')) {
                cardBrand = 'visa';
            } else if (firstBin.startsWith('5')) {
                cardBrand = 'master';
            } else if (firstBin.startsWith('3')) {
                cardBrand = 'amex';
            } else if (/^(4011|43893|504175|636368|636297|5067|4576|4011)/.test(firstBin)) {
                cardBrand = 'elo';
            } else if (/^(6062|5067|5090)/.test(firstBin)) {
                cardBrand = 'hipercard';
            }

            // 3. Post Token and details to backend serverless function
            const payload = {
                payment_method_id: cardBrand,
                token: cardTokenResponse.id,
                installments: parseInt(installmentSelect.value) || 1,
                transaction_amount: state.shippingCost,
                payer: {
                    email: state.donor.email,
                    first_name: state.donor.name.split(' ')[0],
                    last_name: state.donor.name.split(' ').slice(1).join(' ') || 'Devoto',
                    phone: state.donor.phone,
                    identification: {
                        type: 'CPF',
                        number: state.donor.cpf.replace(/\D/g, '')
                    }
                }
            };

            const paymentRes = await fetch('/api/create-payment', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            const paymentData = await paymentRes.json();

            if (!paymentRes.ok) {
                throw new Error(paymentData.message || paymentData.error || 'Pagamento recusado');
            }

            // check status from MP response
            if (paymentData.status === 'approved' || paymentData.status === 'in_process') {
                loader.style.display = 'none';
                
                // Hide PIX container inside view-success
                document.getElementById('success-pix-container').style.display = 'none';

                // Set paymentMethod state
                state.paymentMethod = 'card';

                // Reset view-success headers for approved status
                document.getElementById('success-status-icon').className = 'success-circle';
                document.getElementById('success-status-icon').innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
                document.getElementById('success-status-title').textContent = 'Pedido Confirmado!';
                document.getElementById('success-status-desc').textContent = 'Parabéns! Sua compra foi processada com sucesso. Seus dados de envio já foram repassados para a nossa distribuidora.';

                // Timeline steps
                document.getElementById('timeline-step-1').className = 'timeline-item active';
                document.getElementById('timeline-step-1-desc').textContent = 'Pagamento compensado e pedido gerado no sistema.';
                document.getElementById('timeline-step-2').className = 'timeline-item active';
                document.getElementById('timeline-step-3').className = 'timeline-item pending';

                // Populate success details
                document.getElementById('successDonorName').textContent = state.donor.name;
                document.getElementById('successDisplaySize').textContent = state.donor.size;
                let successShippingText = 'Doação Devoto (Frete Grátis)';
                if (state.shippingType === 'sedex') {
                    successShippingText = 'Doação Protetor (Frete Grátis)';
                } else if (state.shippingType === 'test') {
                    successShippingText = 'Doação Padrinho (Frete Grátis)';
                } else if (state.shippingType === 'benfeitor') {
                    successShippingText = 'Doação Benfeitor (Frete Grátis)';
                }
                document.getElementById('successShippingType').textContent = successShippingText;
                document.getElementById('successTotalPaid').textContent = state.shippingCost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                document.getElementById('successMethodText').textContent = 'Cartão de Crédito';
                
                const fullAddress = `${state.donor.street}, Nº ${state.donor.number} ${state.donor.complement ? '- ' + state.donor.complement : ''}, ${state.donor.neighborhood}, ${state.donor.city}/${state.donor.state}`;
                document.getElementById('successAddressText').textContent = fullAddress;

                // Generate random order ID
                document.getElementById('success-order-id').textContent = `#SR-${Math.floor(Math.random() * 900000 + 100000)}-BR`;

                // Navigate to view-success directly
                this.switchView('view-checkout', 'view-success');

                // Trigger purchase event
                if (window.fbq) fbq('track', 'Purchase', { value: state.shippingCost, currency: 'BRL' });

                // Start Confetti!
                this.startConfetti();
            } else {
                throw new Error('Pagamento não autorizado pelo banco. Tente outro cartão.');
            }

        } catch (err) {
            loader.style.display = 'none';
            alert(`Falha no Pagamento: ${err.message || 'Verifique os dados do cartão e tente novamente.'}`);
        }
    },

    copySuccessPIXKey() {
        const copyInput = document.getElementById('success-pix-code');
        if (!copyInput) return;
        
        copyInput.select();
        copyInput.setSelectionRange(0, 99999);
        
        navigator.clipboard.writeText(copyInput.value)
            .then(() => {
                const alertEl = document.getElementById('success-pix-copy-alert');
                if (alertEl) {
                    alertEl.classList.add('active');
                    setTimeout(() => alertEl.classList.remove('active'), 2500);
                }
            });
    },

    startPixCountdown(duration) {
        let timer = duration;
        const countdownEl = document.getElementById('success-pix-countdown');
        
        if (this.pixInterval) clearInterval(this.pixInterval);
        
        this.pixInterval = setInterval(() => {
            const minutes = parseInt(timer / 60, 10);
            const seconds = parseInt(timer % 60, 10);
            
            const displayMin = minutes < 10 ? "0" + minutes : minutes;
            const displaySec = seconds < 10 ? "0" + seconds : seconds;
            
            if (countdownEl) {
                countdownEl.textContent = displayMin + ":" + displaySec;
            }
            
            if (--timer < 0) {
                clearInterval(this.pixInterval);
                this.pixInterval = null;
                if (countdownEl) countdownEl.textContent = "Expirado";
                this.stopPixPolling();
                alert("O código PIX expirou. Por favor, reinicie o pedido.");
                this.resetEcomFlow();
            }
        }, 1000);
    },

    startPixPolling(paymentId) {
        if (this.pixStatusInterval) clearInterval(this.pixStatusInterval);
        
        this.pixStatusInterval = setInterval(() => {
            fetch(`/api/check-payment?id=${encodeURIComponent(paymentId)}`)
                .then(res => {
                    if (!res.ok) throw new Error();
                    return res.json();
                })
                .then(data => {
                    if (data.status === 'approved') {
                        this.stopPixPolling();
                        
                        // Update status label
                        const label = document.getElementById('success-pix-status-label');
                        if (label) {
                            label.innerHTML = '<span style="color: #34C759; font-weight: 700;">✓ Pagamento confirmado com sucesso!</span>';
                        }
                        
                        const statusCard = document.getElementById('pix-status-card');
                        if (statusCard) {
                            statusCard.style.background = 'rgba(52, 199, 89, 0.08)';
                            statusCard.style.borderColor = 'rgba(52, 199, 89, 0.4)';
                        }
                        
                        const loader = document.getElementById('pix-status-loader');
                        if (loader) loader.style.display = 'none';
                        
                        // Change screen to fully approved
                        setTimeout(() => {
                            this.simulatePaymentSuccess();
                        }, 1500);
                    }
                })
                .catch(err => {
                    console.error("Polling error:", err);
                });
        }, 3000);
    },

    stopPixPolling() {
        if (this.pixStatusInterval) {
            clearInterval(this.pixStatusInterval);
            this.pixStatusInterval = null;
        }
        if (this.pixInterval) {
            clearInterval(this.pixInterval);
            this.pixInterval = null;
        }
    },

    },

    simulatePaymentSuccess() {
        this.stopPixPolling();
        
        // Update header status card in success view
        const icon = document.getElementById('success-status-icon');
        icon.className = 'success-circle';
        icon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        
        document.getElementById('success-status-title').textContent = 'Pedido Confirmado!';
        document.getElementById('success-status-desc').textContent = 'Parabéns! Sua compra foi processada com sucesso. Seus dados de envio já foram repassados para a nossa distribuidora.';

        // Hide PIX container inside view-success
        document.getElementById('success-pix-container').style.display = 'none';

        // Update Timeline
        document.getElementById('timeline-step-1').className = 'timeline-item active';
        document.getElementById('timeline-step-1-desc').textContent = 'Pagamento compensado e pedido gerado no sistema.';
        document.getElementById('timeline-step-2').className = 'timeline-item active';
        document.getElementById('timeline-step-3').className = 'timeline-item pending';

        // Start confetti
        this.startConfetti();
    },

    startConfetti() {
        const canvas = document.getElementById('confetti-canvas');
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        const container = document.querySelector('.mobile-container');
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
        
        const colors = ["#FFCC00", "#FF3B30", "#34C759", "#007AFF", "#AF52DE", "#5AC8FA"];
        const particles = [];
        this.confettiActive = true;
        
        for (let i = 0; i < 100; i++) {
            particles.push({
                x: Math.random() * canvas.width,
                y: Math.random() * -canvas.height - 20,
                r: Math.random() * 6 + 4,
                d: Math.random() * canvas.height,
                color: colors[Math.floor(Math.random() * colors.length)],
                tilt: Math.random() * 10 - 5,
                tiltAngleIncremental: Math.random() * 0.07 + 0.02,
                tiltAngle: 0
            });
        }
        
        const draw = () => {
            if (!this.confettiActive) return;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            particles.forEach((p, idx) => {
                p.tiltAngle += p.tiltAngleIncremental;
                p.y += (Math.cos(p.d) + 3 + p.r / 2) / 2;
                p.x += Math.sin(p.tiltAngle);
                
                ctx.beginPath();
                ctx.lineWidth = p.r;
                ctx.strokeStyle = p.color;
                ctx.moveTo(p.x + p.tilt + p.r / 2, p.y);
                ctx.lineTo(p.x + p.tilt, p.y + p.tilt + p.r / 2);
                ctx.stroke();
                
                if (p.y > canvas.height) {
                    particles[idx] = {
                        x: Math.random() * canvas.width,
                        y: -20,
                        r: p.r,
                        d: p.d,
                        color: p.color,
                        tilt: p.tilt,
                        tiltAngleIncremental: p.tiltAngleIncremental,
                        tiltAngle: p.tiltAngle
                    };
                }
            });
            
            requestAnimationFrame(draw);
        };
        
        draw();
        
        setTimeout(() => {
            this.confettiActive = false;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }, 6000);
    },

    resetEcomFlow() {
        this.stopPixPolling();
        
        // Hide success containers
        document.getElementById('success-pix-container').style.display = 'none';

        // Reset all views and form inputs
        this.switchView('view-success', 'view-product');
        
        document.getElementById('form-personal').reset();
        document.getElementById('form-shipping').reset();
        
        // Clear state
        state.shippingType = 'normal';
        state.shippingCost = 10.00;
        state.totalCost = 10.00;
        state.paymentMethod = 'pix';
        state.donor.size = 'M';
        
        // Reset active size button
        const buttons = document.querySelectorAll('.size-btn');
        buttons.forEach(btn => {
            btn.classList.toggle('active', btn.textContent === 'M');
        });
        const checkoutSizeDisp = document.getElementById('checkoutDisplaySize');
        if (checkoutSizeDisp) checkoutSizeDisp.textContent = 'M';
        
        this.updateShipping(10.00, 'normal');
        this.switchPaymentTab('pix');
        
        window.scrollTo({ top: 0 });
    },

    /* ==========================================================================
       IMAGE ZOOM MODAL ACTIONS
       ========================================================================== */
    zoomImage(src) {
        const overlay = document.getElementById('zoom-modal');
        const img = document.getElementById('zoom-modal-img');
        img.src = src;
        overlay.classList.add('active');
    },

    closeZoomImage() {
        document.getElementById('zoom-modal').classList.remove('active');
    },
    
    showNotificationTip() {
        const toast = document.getElementById('toast-tip');
        toast.classList.add('active');
        setTimeout(() => toast.classList.remove('active'), 5000);
    },

    openPolicy(type) {
        const titleEl = document.getElementById('policy-modal-title');
        const contentEl = document.getElementById('policy-modal-content');
        const modal = document.getElementById('policy-modal');
        if (!titleEl || !contentEl || !modal) return;

        const policies = {
            privacy: {
                title: "Política de Privacidade",
                html: `
                    <p>A sua privacidade é de extrema importância para nós. Esta política descreve como coletamos, usamos e protegemos as suas informações pessoais em conformidade com a Lei Geral de Proteção de Dados (LGPD).</p>
                    <h4 style="margin: 16px 0 8px; color: var(--clr-primary); font-family: 'Outfit', sans-serif;">1. Coleta de Informações</h4>
                    <p>Coletamos dados básicos fornecidos voluntariamente por você ao solicitar o presente sagrado, tais como: nome completo, endereço de e-mail, número de celular e endereço postal de entrega.</p>
                    <h4 style="margin: 16px 0 8px; color: var(--clr-primary); font-family: 'Outfit', sans-serif;">2. Uso dos Dados</h4>
                    <p>Seus dados pessoais são utilizados unicamente para processar sua doação voluntária, gerenciar o envio postal do seu brinde e enviar as atualizações automáticas de rastreamento do pacote através do WhatsApp.</p>
                    <h4 style="margin: 16px 0 8px; color: var(--clr-primary); font-family: 'Outfit', sans-serif;">3. Segurança e Sigilo</h4>
                    <p>Nós não vendemos, alugamos ou compartilhamos suas informações com terceiros, exceto com os intermediadores de pagamento e distribuidoras postais estritamente necessários para a entrega física de seu brinde.</p>
                `
            },
            terms: {
                title: "Termos de Uso",
                html: `
                    <p>Bem-vindo à nossa comunidade de fé. Ao acessar esta página e realizar uma doação voluntária, você concorda com os seguintes termos e condições:</p>
                    <h4 style="margin: 16px 0 8px; color: var(--clr-primary); font-family: 'Outfit', sans-serif;">1. Caráter das Doações</h4>
                    <p>Todas as transações financeiras realizadas por meio deste funil representam doações voluntárias destinadas ao custeio de nossas obras de caridade e devoção social. As contribuições não configuram uma transação de compra comercial.</p>
                    <h4 style="margin: 16px 0 8px; color: var(--clr-primary); font-family: 'Outfit', sans-serif;">2. Responsabilidade sobre os Dados</h4>
                    <p>O usuário é inteiramente responsável pela veracidade e exatidão dos dados inseridos nos campos de cadastro (como nome, endereço postal de envio e CPF), garantindo a viabilidade da entrega física do presente oferecido.</p>
                    <h4 style="margin: 16px 0 8px; color: var(--clr-primary); font-family: 'Outfit', sans-serif;">3. Propriedade Intelectual</h4>
                    <p>Todo o material de fotos, logotipos, textos e artes contidos neste site são de uso exclusivo de nossa associação e parceiros autorizados, sendo vedada a reprodução comercial sem prévio consentimento.</p>
                `
            },
            shipping: {
                title: "Política de Envio e Doação",
                html: `
                    <p style="font-style: italic; color: #555; border-left: 3px solid var(--clr-primary); padding-left: 10px; margin-bottom: 16px;">
                        "A nossa associação se sustenta puramente através da fé e do coração generoso de nossos devotos. A Camisa Devocional de Nossa Senhora Aparecida é um presente especial de agradecimento, confeccionado com muito amor e devoção."
                    </p>
                    <p>Para viabilizar a fabricação, o controle de qualidade, a embalagem protetora e o envio postal de forma sustentável para nossa obra de evangelização, o brinde físico da <strong>Camisa Devocional de Nossa Senhora Aparecida</strong> é enviado exclusivamente como agradecimento aos devotos que realizarem uma contribuição/doação voluntária mínima de <strong>R$ 50,00</strong>.</p>
                    <p>Doações de valores inferiores a este mínimo (como R$ 10,00, R$ 15,00 ou R$ 20,00) são imensamente bem-vindas e integralmente revertidas para a manutenção dos nossos projetos sociais, porém não nos dão a sustentabilidade financeira necessária para custear a confecção e o frete interestadual da camisa física de forma gratuita.</p>
                    <p>Agradecemos profundamente de coração a sua compreensão e generosidade, que nos ajudam a manter viva essa abençoada missão de fé.</p>
                `
            }
        };

        const selected = policies[type];
        if (selected) {
            titleEl.textContent = selected.title;
            contentEl.innerHTML = selected.html;
            modal.style.display = 'flex';
        }
    },

    closePolicy() {
        const modal = document.getElementById('policy-modal');
        if (modal) modal.style.display = 'none';
    }
};

/* ==========================================================================
   SIMULATED CLIENT TOAST NOTIFICATIONS (SOCIAL PROOF)
   ========================================================================== */
function initNotifications() {
    const locations = [
        'São Paulo/SP', 'Rio de Janeiro/RJ', 'Belo Horizonte/MG', 'Curitiba/PR', 
        'Porto Alegre/RS', 'Salvador/BA', 'Recife/PE', 'Fortaleza/CE', 
        'Goiânia/GO', 'Campinas/SP', 'São Luís/MA', 'Manaus/AM'
    ];
    
    const names = [
        'Maria', 'Ana', 'Francisca', 'José', 'João', 'Antônio', 'Clara',
        'Sebastião', 'Geraldo', 'Teresa', 'Fátima', 'Aparecida', 'Felipe'
    ];
    
    const toast = document.getElementById('toast-tip');
    const toastMsg = toast.querySelector('.toast-msg');
    
    const triggerToast = () => {
        const name = names[Math.floor(Math.random() * names.length)];
        const loc = locations[Math.floor(Math.random() * locations.length)];
        
        toastMsg.innerHTML = `<strong>${name}</strong> de ${loc} acabou de solicitar a camisa grátis.`;
        toast.classList.add('active');
        
        setTimeout(() => {
            toast.classList.remove('active');
        }, 5000);
    };
    
    // Start after 8 seconds, loop every 20 seconds
    setTimeout(() => {
        triggerToast();
        setInterval(triggerToast, 20000);
    }, 8000);
}
window.app = app;
