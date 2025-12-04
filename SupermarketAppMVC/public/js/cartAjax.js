// AJAX cart add: intercept product add-to-cart forms
(function(){
  function updateCartBadge(count){
    var badge = document.querySelector('[data-cart-count]');
    if (badge){ badge.textContent = count; }
  }
  document.addEventListener('submit', function(e){
    var form = e.target;
    if (form.matches('form[action^="/add-to-cart/"]')){
      e.preventDefault();
      var action = form.getAttribute('action');
      var idMatch = action.match(/\/add-to-cart\/(\d+)/);
      if (!idMatch) return form.submit(); // fallback
      var id = idMatch[1];
      var qtyInput = form.querySelector('input[name="quantity"]');
      var quantity = qtyInput ? parseInt(qtyInput.value,10)||1 : 1;
      fetch('/api/cart/add/' + id, {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ quantity: quantity })
      }).then(r=> r.json())
        .then(data => {
          if (!data.success){ throw new Error(data.error || 'Failed'); }
          updateCartBadge(data.cartCount);
          // Update stock display and input max in the card
          try {
            var card = form.closest('.product-card');
            if (card && typeof data.remaining === 'number') {
              var stockEl = card.querySelector('.stock');
              if (stockEl) {
                if (data.remaining > 0) {
                  stockEl.textContent = 'Stock: ' + data.remaining;
                } else {
                  stockEl.innerHTML = '<span class="badge bg-danger">Sold Out</span>';
                }
              }
              var qtyInput = card.querySelector('.qty-input');
              var addBtn = form.querySelector('button[type="submit"]');
              if (qtyInput) {
                qtyInput.setAttribute('data-max', data.remaining);
                qtyInput.setAttribute('max', data.remaining);
                if (data.remaining === 0) {
                  qtyInput.value = 0;
                  qtyInput.disabled = true;
                } else if (parseInt(qtyInput.value,10) > data.remaining) {
                  qtyInput.value = data.remaining;
                }
              }
              if (addBtn && data.remaining === 0) {
                addBtn.disabled = true;
                addBtn.textContent = 'Not Available';
              }
            }
          } catch (_) {}
          // feedback toast
          var msg = document.createElement('div');
          msg.className = 'ajax-toast';
          msg.textContent = data.message;
          document.body.appendChild(msg);
          setTimeout(()=> msg.classList.add('show'));
          setTimeout(()=> { msg.classList.remove('show'); setTimeout(()=> msg.remove(),400); }, 2500);
        })
        .catch(err => {
          console.error('Add to cart failed', err);
          alert('Failed to add to cart');
        });
    }
  });
})();
/* Minimal styles injected dynamically if not present */
(function(){
  var style = document.createElement('style');
  style.textContent = '.ajax-toast{position:fixed;bottom:1.25rem;right:1.25rem;background:#2563eb;color:#fff;padding:.75rem 1rem;border-radius:.5rem;box-shadow:0 4px 12px rgba(0,0,0,.15);opacity:0;transform:translateY(10px);transition:.3s;} .ajax-toast.show{opacity:1;transform:translateY(0);}';
  document.head.appendChild(style);
})();
