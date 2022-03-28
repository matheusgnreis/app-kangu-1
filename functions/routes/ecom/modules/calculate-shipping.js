const axios = require('axios')
const ecomUtils = require('@ecomplus/utils')

exports.post = ({ appSdk }, req, res) => {
  /**
   * Treat `params` and (optionally) `application` from request body to properly mount the `response`.
   * JSON Schema reference for Calculate Shipping module objects:
   * `params`: https://apx-mods.e-com.plus/api/v1/calculate_shipping/schema.json?store_id=100
   * `response`: https://apx-mods.e-com.plus/api/v1/calculate_shipping/response_schema.json?store_id=100
   *
   * Examples in published apps:
   * https://github.com/ecomplus/app-mandabem/blob/master/functions/routes/ecom/modules/calculate-shipping.js
   * https://github.com/ecomplus/app-kangu/blob/master/functions/routes/ecom/modules/calculate-shipping.js
   * https://github.com/ecomplus/app-jadlog/blob/master/functions/routes/ecom/modules/calculate-shipping.js
   */

  const { params, application } = req.body
  const { storeId } = req
  // setup basic required response object
  const response = {
    shipping_services: []
  }
  // merge all app options configured by merchant
  const appData = Object.assign({}, application.data, application.hidden_data)

  const token = appData.kangu_token
  if (!token) {
    // must have configured kangu doc number and token
    return res.status(409).send({
      error: 'CALCULATE_AUTH_ERR',
      message: 'Token or document unset on app hidden data (merchant must configure the app)'
    })
  }

  const ordernar = appData.ordernar ? appData.ordernar : 'preco'

  if (appData.free_shipping_from_value >= 0) {
    response.free_shipping_from_value = appData.free_shipping_from_value
  }

  const destinationZip = params.to ? params.to.zip.replace(/\D/g, '') : ''
  const originZip = params.from
    ? params.from.zip.replace(/\D/g, '')
    : appData.zip ? appData.zip.replace(/\D/g, '') : ''

  const checkZipCode = rule => {
    // validate rule zip range
    if (destinationZip && rule.zip_range) {
      const { min, max } = rule.zip_range
      return Boolean((!min || destinationZip >= min) && (!max || destinationZip <= max))
    }
    return true
  }

  // search for configured free shipping rule
  if (Array.isArray(appData.free_shipping_rules)) {
    for (let i = 0; i < appData.free_shipping_rules.length; i++) {
      const rule = appData.free_shipping_rules[i]
      if (rule && checkZipCode(rule)) {
        if (!rule.min_amount) {
          response.free_shipping_from_value = 0
          break
        } else if (!(response.free_shipping_from_value <= rule.min_amount)) {
          response.free_shipping_from_value = rule.min_amount
        }
      }
    }
  }

  if (!params.to) {
    // just a free shipping preview with no shipping address received
    // respond only with free shipping option
    res.send(response)
    return
  }

  /* DO THE STUFF HERE TO FILL RESPONSE OBJECT WITH SHIPPING SERVICES */

  if (!originZip) {
    // must have configured origin zip code to continue
    return res.status(409).send({
      error: 'CALCULATE_ERR',
      message: 'Zip code is unset on app hidden data (merchant must configure the app)'
    })
  }



  if (params.items) {
    const headers = {
      token,
      accept: 'application/json',
      'Content-Type': 'application/json'
  }
    // send POST request to kangu REST API
    return axios.post(
      'https://portal.kangu.com.br/tms/transporte/simular',    
      {
        cepOrigem: originZip,
        cepDestino: destinationZip,
        origem: 'E-Com Plus',
        produtos: params.items.map(item => {
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
            produto: name,
            servicos: [ 
              "E",
              "X",
              "R"
            ],
            ordernar
          }
        })
      },
      { headers }
    )

      .then(({ data, status }) => {
        let result
        if (typeof data === 'string') {
          try {
            result = JSON.parse(data)
          } catch (e) {
            console.log('> kangu invalid JSON response')
            return res.status(409).send({
              error: 'CALCULATE_INVALID_RES',
              message: data
            })
          }
        } else {
          result = data
        }

        if (result && Number(status) === 200 && Array.isArray(result)) {
          // success response
          result.forEach(kanguService => {
            // parse to E-Com Plus shipping line object
            const serviceCode = String(kanguService.referencia)
            const price = kanguService.vlrFrete
    
            // push shipping service object to response
            response.shipping_services.push({
              label: kanguService.transp_nome|| kanguService.descricao,
              carrier: kanguService.transp_nome,
              carrier_doc_number: typeof kanguService.cnpjTransp === 'string'
                ? kanguService.cnpjTransp.replace(/\D/g, '').substr(0, 19)
                : undefined,
              service_name: `${(kanguService.descricao || serviceCode)} (Kangu)`,
              service_code: serviceCode,
              shipping_line: {
                from: {
                  ...params.from,
                  zip: originZip
                },
                to: params.to,
                price,
                total_price: price,
                discount: 0,
                delivery_time: {
                  days: parseInt(kanguService.prazoEnt, 10),
                  working_days: true
                },
                posting_deadline: {
                  days: 3,
                  ...appData.posting_deadline
                },
                flags: ['kangu-ws', `kangu-${serviceCode}`.substr(0, 20)]
              }
            })
          })
          res.send(response)
        } else {
          // console.log(data)
          const err = new Error('Invalid Kangu calculate response')
          err.response = { data, status }
          throw err
        }
      })

      .catch(err => {
        let { message, response } = err
        if (response && response.data) {
          // try to handle kangu error response
          const { data } = response
          let result
          if (typeof data === 'string') {
            try {
              result = JSON.parse(data)
            } catch (e) {
            }
          } else {
            result = data
          }
          console.log('> kangu invalid result:', data)
          if (result && result.data) {
            // kangu error message
            return res.status(409).send({
              error: 'CALCULATE_FAILED',
              message: result.data
            })
          }
          message = `${message} (${response.status})`
        } else {
          console.error(err)
        }
        return res.status(409).send({
          error: 'CALCULATE_ERR',
          message
        })
      })
  } else {
    res.status(400).send({
      error: 'CALCULATE_EMPTY_CART',
      message: 'Cannot calculate shipping without cart items'
    })
  }

  // add new shipping service option
  response.shipping_services.push({
    label: appData.label || 'My shipping method',
    carrier: 'My carrier',
    shipping_line: {
      from: appData.from,
      to: params.to,
      package: {
        weight: {
          value: totalWeight
        }
      },
      price: 10,
      delivery_time: {
        days: 3,
        working_days: true
      }
    }
  })

  res.send(response)
}
