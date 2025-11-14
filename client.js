// public/client.js

document.getElementById('comprar-btn').addEventListener('click', () => {
  // ⚠️ SUBSTITUA PELA URL DO SEU RENDER.COM
  const BACKEND_URL = 'https://mpteste.onrender.com'; 
  
  fetch(`${BACKEND_URL}/create_preference`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    // Envia o ID do produto que deve ser vendido.
    // O backend usará isso para buscar o token do vendedor no DB.
    body: JSON.stringify({ productId: 'produto-split-real' }) 
  })
  .then(response => response.json())
  .then(data => {
    if (data.init_point) {
      window.location.href = data.init_point;
    } else {
      alert('Não foi possível gerar o link de pagamento. Verifique o console do backend.');
    }
  })
  .catch(error => {
    console.error('Erro:', error);
    alert('Erro ao processar compra.');
  });
});
