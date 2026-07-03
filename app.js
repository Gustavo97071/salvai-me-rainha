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
document.addEventListener('DOMContentLoaded', () => {
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
        const tabBoleto = document.getElementById('tab-boleto');
        
        const subformPix = document.getElementById('subform-pix');
        const subformBoleto = document.getElementById('subform-boleto');

        if (method === 'pix') {
            tabPix.classList.add('active');
            tabBoleto.classList.remove('active');
            subformPix.classList.add('active');
            subformBoleto.classList.remove('active');
        } else {
            tabPix.classList.remove('active');
            tabBoleto.classList.add('active');
            subformPix.classList.remove('active');
            subformBoleto.classList.add('active');
        }
    },

    generateNativePayment(method) {
        // Show loader spinner
        const loader = document.getElementById('payment-loader');
        loader.style.display = 'flex';

        setTimeout(() => {
            loader.style.display = 'none';
            
            // Navigate to view-payment overlay screen
            document.getElementById('view-checkout').classList.remove('active');
            document.getElementById('view-payment').classList.add('active');
            
            const costText = state.shippingCost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

            if (method === 'pix') {
                document.getElementById('paymentHeaderTitle').textContent = 'Pagar Taxa de Envio (PIX)';
                document.getElementById('payment-pix-details').classList.remove('hidden');
                document.getElementById('payment-boleto-details').classList.add('hidden');
                
                document.getElementById('pixDetailsDisplayAmount').textContent = costText;
                
                // Generate QR Code via QRServer API
                const qrPayload = `pix:acnsf-envio-pulseira-${state.shippingCost}-${state.donor.cpf}`;
                document.getElementById('pixDetailsQrImage').src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(qrPayload)}`;
                
                // Set auto confirm mock timeout after 15 seconds
                window.paymentMockTimeout = setTimeout(() => {
                    app.simulatePaymentSuccess();
                }, 15000);
            } else {
                document.getElementById('paymentHeaderTitle').textContent = 'Pagar Taxa de Envio (Boleto)';
                document.getElementById('payment-pix-details').classList.add('hidden');
                document.getElementById('payment-boleto-details').classList.remove('hidden');
                
                document.getElementById('boletoDetailsDisplayAmount').textContent = costText;
            }
        }, 1200);
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

    copyBoletoCode() {
        const input = document.getElementById('boletoCopyCode');
        input.select();
        input.setSelectionRange(0, 99999);
        navigator.clipboard.writeText(input.value)
            .then(() => {
                const msg = document.getElementById('copyBoletoSuccessMsg');
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
