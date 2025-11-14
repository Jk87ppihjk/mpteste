// client.js (Lógica de comunicação com o backend)

document.addEventListener('DOMContentLoaded', () => {
    // ⚠️ SUBSTITUA PELA URL REAL DO SEU DEPLOY NO RENDER.COM
    const BACKEND_URL = 'https://mpteste.onrender.com'; 
    
    const comprarBtn = document.getElementById('comprar-btn');
    const loadingDiv = document.getElementById('loading');

    if (loadingDiv) {
         loadingDiv.style.display = 'none';
    }

    if (!comprarBtn) return;

    comprarBtn.addEventListener('click', async () => {
        
        comprarBtn.disabled = true;
        loadingDiv.style.display = 'block';

        const productIdToBuy = 'produto-split-real'; 
        // Adicionamos o email do pagador conforme a última correção
        const payerEmailToSend = 'comprador_teste@marketplace.com'; 

        try {
            const response = await fetch(`${BACKEND_URL}/create_preference`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                // ENVIANDO O PRODUTO E O EMAIL PARA O BACKEND
                body: JSON.stringify({ 
                    productId: productIdToBuy,
                    payerEmail: payerEmailToSend
                }) 
            });

            const data = await response.json();

            if (data.init_point) {
                // Redireciona o comprador para o checkout do Mercado Pago
                window.location.href = data.init_point;
            } else {
                // Trata erros retornados do servidor
                alert(`Falha no Backend: ${data.error || 'Verifique os logs do Render.com.'}`);
                console.error("Erro completo do backend:", data);
            }
            
        } catch (error) {
            console.error('Erro de rede ou chamada:', error);
            alert('Falha na comunicação com o servidor. Verifique se o backend está ativo.');
        } finally {
            comprarBtn.disabled = false;
            loadingDiv.style.display = 'none';
        }
    });
});
