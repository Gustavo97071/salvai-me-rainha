/* ==========================================================================
   APP STATE
   ========================================================================== */
const state = {
    shippingType: 'normal',
    shippingCost: 19.90,
    totalCost: 19.90,
    paymentMethod: 'pix',
    donor: {
        name: '',
        email: '',
        phone: '',
        cpf: '',
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
    initNotifications();
    
    // Format CPF Input as typing
    const cpfInput = document.getElementById('input-cpf');
    cpfInput.addEventListener('input', (e) => {
        let value = e.target.value.replace(/\D/g, '');
        if (value.length > 11) value = value.substring(0, 11);
        
        if (value.length > 9) {
            value = value.replace(/^(\d{3})(\d{3})(\d{3})(\d{1,2})$/, '$1.$2.$3-$4');
        } else if (value.length > 6) {
            value = value.replace(/^(\d{3})(\d{3})(\d{1,3})$/, '$1.$2.$3');
        } else if (value.length > 3) {
            value = value.replace(/^(\d{3})(\d{1,3})$/, '$1.$2');
        }
        e.target.value = value;
    });

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

    /* ==========================================================================
       CHECKOUT VIEW NAVIGATION
       ========================================================================== */
    openCheckout() {
        document.getElementById('view-product').classList.remove('active');
        document.getElementById('view-checkout').classList.add('active');
        window.scrollTo({ top: 0 });
    },

    closeCheckout() {
        document.getElementById('view-checkout').classList.remove('active');
        document.getElementById('view-product').classList.add('active');
        window.scrollTo({ top: 0 });
    },

    goToCheckoutStep3() {
        document.getElementById('view-payment').classList.remove('active');
        document.getElementById('view-checkout').classList.add('active');
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
        
        window.scrollTo({ top: 0 });
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
            const cpfInput = document.getElementById('input-cpf');

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

            // CPF validation (length check)
            const cpfVal = cpfInput.value.replace(/\D/g, '');
            if (cpfVal.length !== 11) {
                this.setInputError(cpfInput, 'error-cpf', true);
                isValid = false;
            } else {
                this.setInputError(cpfInput, 'error-cpf', false);
            }

            if (isValid) {
                state.donor.name = nameVal;
                state.donor.email = emailInput.value.trim();
                state.donor.phone = phoneInput.value.trim();
                state.donor.cpf = cpfInput.value.trim();
                
                this.goToStep(2);
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
        state.totalCost = cost; // product is 0, so total is just shipping

        // Adjust active shipping cards styles
        const normalCard = document.getElementById('label-shipping-normal');
        const sedexCard = document.getElementById('label-shipping-sedex');

        if (type === 'normal') {
            normalCard.classList.add('active');
            sedexCard.classList.remove('active');
        } else {
            normalCard.classList.remove('active');
            sedexCard.classList.add('active');
        }
    },

    updateShippingDetailsBox() {
        const typeText = state.shippingType === 'normal' ? 'Frete Expresso Seguro' : 'Frete Urgente Sedex';
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
            
            // Navigate to view-payment screen
            document.getElementById('view-checkout').classList.remove('active');
            document.getElementById('view-payment').classList.add('active');
            
            document.getElementById('paymentHeaderTitle').textContent = 'Pagar Taxa de Envio (PIX)';
            document.getElementById('pixDetailsDisplayAmount').textContent = state.shippingCost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            
            // Populate Real QR Code base64 image and text copy key from Mercado Pago!
            const qrCodeBase64 = data.point_of_interaction.transaction_data.qr_code_base64;
            const qrCodeText = data.point_of_interaction.transaction_data.qr_code;
            
            document.getElementById('pixDetailsQrImage').src = `data:image/jpeg;base64,${qrCodeBase64}`;
            document.getElementById('pixDetailsCopyCode').value = qrCodeText;
            
            // Periodically check status (mock auto confirmation or we can let the user trigger manual confirmation)
            if (window.paymentMockTimeout) clearTimeout(window.paymentMockTimeout);
            window.paymentMockTimeout = setTimeout(() => {
                app.simulatePaymentSuccess();
            }, 10000); // Auto confirm after 10s for simulation
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
                
                // Navigate to view-success directly
                document.getElementById('view-checkout').classList.remove('active');
                document.getElementById('view-success').classList.add('active');
                
                // Populate success details
                document.getElementById('successDonorName').textContent = state.donor.name.split(' ')[0];
                document.getElementById('successDisplaySize').textContent = state.donor.size;
                document.getElementById('successShippingType').textContent = state.shippingType === 'normal' ? 'Frete Expresso' : 'Sedex Prioritário';
                document.getElementById('successTotalPaid').textContent = state.shippingCost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                document.getElementById('successMethodText').textContent = 'Cartão de Crédito';
                document.getElementById('successDonorEmail').textContent = state.donor.email;
                
                const fullAddress = `${state.donor.street}, Nº ${state.donor.number} ${state.donor.complement ? '- ' + state.donor.complement : ''}, ${state.donor.neighborhood}, ${state.donor.city}/${state.donor.state}`;
                document.getElementById('successAddressText').textContent = fullAddress;
            } else {
                throw new Error('Pagamento não autorizado pelo banco. Tente outro cartão.');
            }

        } catch (err) {
            loader.style.display = 'none';
            alert(`Falha no Pagamento: ${err.message || 'Verifique os dados do cartão e tente novamente.'}`);
        }
    },

    copyPixCode() {
        const input = document.getElementById('pixDetailsCopyCode');
        input.select();
        input.setSelectionRange(0, 99999);
        navigator.clipboard.writeText(input.value)
            .then(() => {
                const msg = document.getElementById('copySuccessMsg');
                msg.classList.remove('hidden');
                setTimeout(() => msg.classList.add('hidden'), 3000);
            });
    },



    simulatePaymentSuccess() {
        if (window.paymentMockTimeout) {
            clearTimeout(window.paymentMockTimeout);
        }
        
        // Hide payment view, show success view
        document.getElementById('view-payment').classList.remove('active');
        document.getElementById('view-success').classList.add('active');
        
        // Populate success view details
        document.getElementById('successDonorName').textContent = state.donor.name.split(' ')[0];
        document.getElementById('successDisplaySize').textContent = state.donor.size;
        document.getElementById('successShippingType').textContent = state.shippingType === 'normal' ? 'Frete Expresso' : 'Sedex Prioritário';
        document.getElementById('successTotalPaid').textContent = state.shippingCost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        document.getElementById('successMethodText').textContent = state.paymentMethod.toUpperCase();
        document.getElementById('successDonorEmail').textContent = state.donor.email;
        
        const fullAddress = `${state.donor.street}, Nº ${state.donor.number} ${state.donor.complement ? '- ' + state.donor.complement : ''}, ${state.donor.neighborhood}, ${state.donor.city}/${state.donor.state}`;
        document.getElementById('successAddressText').textContent = fullAddress;
    },

    resetEcomFlow() {
        // Reset all views and form inputs
        document.getElementById('view-success').classList.remove('active');
        document.getElementById('view-product').classList.add('active');
        
        document.getElementById('form-personal').reset();
        document.getElementById('form-shipping').reset();
        
        // Clear state
        state.shippingType = 'normal';
        state.shippingCost = 19.90;
        state.totalCost = 19.90;
        state.paymentMethod = 'pix';
        state.donor.size = 'M';
        
        // Reset active size button
        const buttons = document.querySelectorAll('.size-btn');
        buttons.forEach(btn => {
            btn.classList.toggle('active', btn.textContent === 'M');
        });
        const checkoutSizeDisp = document.getElementById('checkoutDisplaySize');
        if (checkoutSizeDisp) checkoutSizeDisp.textContent = 'M';
        
        this.updateShipping(19.90, 'normal');
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
