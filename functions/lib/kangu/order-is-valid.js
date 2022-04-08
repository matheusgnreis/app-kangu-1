module.exports = (order, appConfig) => {
  if (!order.fulfillment_status || !order.shipping_lines) {
    return false
  }

  // verifica se o calculo do frete foi feito pela kangu
  const isByKangu = Boolean(order.shipping_lines.find(shippingLine => {
    return shippingLine.custom_fields && shippingLine.custom_fields.find(({ field }) => {
      return field === 'kangu_reference'
    })
  }))

  // verifica se o pedido está pronto para envio pela ultima entrada no fulfillments ao inves de checar o fulfillment_status
  const isReadyForShipping = () => {
    const { current } = order.fulfillment_status
    return (current && current === 'ready_for_shipping')
  }

  if (!isByKangu || !isReadyForShipping()) {
    return false
  }


  return false
}
