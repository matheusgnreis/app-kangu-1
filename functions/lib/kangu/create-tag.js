const axios = require('axios')
const ecomUtils = require('@ecomplus/utils')

module.exports = (token, order) => {
  // create new shipping tag with Kangu
  // https://portal.kangu.com.br/docs/api/transporte/#/
  const headers = {
    token,
    accept: 'application/json',
    'Content-Type': 'application/json'
  }

  const data = {}

  // start parsing order body
  if (order.items) {
    data.produtos = order.items.map(item => {
      const { name, quantity, dimensions, weight } = item
      // parse cart items to kangu schema
      let kgWeight = 0
      if (weight && weight.value) {
        switch (weight.unit) {
          case 'g':
            kgWeight = weight.value / 1000
            break
          case 'mg':
            kgWeight = weight.value / 1000000
            break
          default:
            kgWeight = weight.value
        }
      }
      const cmDimensions = {}
      if (dimensions) {
        for (const side in dimensions) {
          const dimension = dimensions[side]
          if (dimension && dimension.value) {
            switch (dimension.unit) {
              case 'm':
                cmDimensions[side] = dimension.value * 100
                break
              case 'mm':
                cmDimensions[side] = dimension.value / 10
                break
              default:
                cmDimensions[side] = dimension.value
            }
          }
        }
      }
      return {
        peso: kgWeight,
        altura: cmDimensions.height || 0,
        largura: cmDimensions.width || 0,
        comprimento: cmDimensions.length || 0,
        valor: ecomUtils.price(item),
        quantidade: quantity,
        produto: name
      }
    })
  }
  data.origem = 'E-Com Plus'

  data.pedido = {
    numeroCli: order._id,
    vlrMerc: order.amount && order.amount.total || 0
  }
  

  const buyer = order.buyers && order.buyers[0]
  if (buyer && buyer.registry_type === 'p' && buyer.doc_number) {
    data.cpf_destinatario = buyer.doc_number.replace(/\D/g, '')
  }

  const requests = []
  if (order.shipping_lines) {
    order.shipping_lines.forEach(shippingLine => {
      if (shippingLine.app) {
        data.servicos = [shippingLine.service_code]
        // parse addresses and package info from shipping line object
        if (shippingLine.from) {
          data.remetente = {
            
          }
        }
        data.destinatario = shippingLine.to.name
        data.cep = shippingLine.to.zip.replace(/\D/g, '')
        data.logradouro = shippingLine.to.street
        data.bairro = shippingLine.to.borough
        data.numero = shippingLine.to.number || 'SN'
        if (shippingLine.to.complement) {
          data.complemento = shippingLine.to.complement
        }
        data.cidade = shippingLine.to.city
        data.estado = shippingLine.to.province_code
        if (shippingLine.package && shippingLine.package.weight) {
          const { value, unit } = shippingLine.package.weight
          data.pedido.pesoMerc = !unit || unit === 'kg' ? value
            : unit === 'g' ? value * 1000
              : value * 1000000
        }
        if (shippingLine.declared_value) {
          data.valor_seguro = shippingLine.declared_value
        }
        data.cep_origem = shippingLine.from.zip.replace(/\D/g, '')
        console.log(`> Create tag for #${order._id}: ` + JSON.stringify(data))
        // send POST to generate Manda Bem tag
        requests.push(axios.post(
          'https://mandabem.com.br/ws/gerar_envio',
          qs.stringify(data),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded'
            }
          }
        ).then(response => {
          console.log('> Manda Bem create tag', JSON.stringify(response.data))
          return response
        }).catch(console.error))    
      }
    })
  }
  return Promise.all(requests)
}
