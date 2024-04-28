require('dotenv').config();
const express = require('express');
const _ = require('lodash')
const bodyParser = require('body-parser');
const axios = require('axios');
const authenticate = require('./src/authenticate');

const app = express();
const port = process.env.PORT || 8080;

app.use(bodyParser.json());

async function getAccessToken() {
    const tokenUrl = process.env.CORE_API_OAUTH_TOKEN_URL;
    const clientId = process.env.CORE_API_OAUTH_CLIENT_ID;
    const clientSecret = process.env.CORE_API_OAUTH_CLIENT_SECRET;

    try {
        const accessToken = await authenticate(tokenUrl, clientId, clientSecret);
        return accessToken;
    } catch (error) {
        console.error('Error obtaining access token:', error);
        throw error; // Rethrow the error to handle it in the calling context
    }
}

app.get('/currency-converter', async (req, res) => {
    try {
        const currencyCode = req.query.currencyCode;
        const numberOfDays = req.query.numberOfDays;
        const type = req.query.type;
        console.log(`Request received - currencyCode[${currencyCode}] numberOfDays[${numberOfDays}] type[${type}]`);
        if (!currencyCode) {
            return res.status(400).send('currencyCode query parameter is required');
        }
        if (!numberOfDays) {
            return res.status(400).send('numberOfDays query parameter is required');
        }

        const accessToken = await getAccessToken();

        const coreApiServiceUrl = process.env.CORE_API_SERVICE_URL;
        const ratesResponse = await axios.get(`${coreApiServiceUrl}/internal/exchange-rates/${type.toLowerCase()}?currencyCode=${currencyCode}&lastNumberOfDays=${numberOfDays}`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
            },
        });
        const banksResponse = await axios.get(`${coreApiServiceUrl}/internal/banks`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
            },
        });
        const ratesResponseData = ratesResponse.data;
        const banksResponseData = banksResponse.data;
        
        const bankDetailsMap = getBankDetailsMapByBankCode(banksResponseData);
        const ratesMap = getRatesMapByDate(ratesResponseData);
        const ratesSummary = getRatesSummaryByBank(ratesMap);

        const response = {
            ratesSummary,
            ratesMap,
            bankDetailsMap
        }
        res.status(ratesResponse.status).send(response);
    } catch (error) {
        console.error('Error fetching appointments:', error);
        res.status(error.response ? error.response.status : 500).send(error.message);
    }
});

const getBankDetailsMapByBankCode = (bankResponse) => {
    return _.keyBy(bankResponse, 'bankCode');
}

const getRatesMapByDate = (ratesResponse) => {
    const flattenRatesList = _.flatMap(_.values(ratesResponse));
    return _.groupBy(flattenRatesList, ({date}) => date);
}

const getRatesSummaryByBank = (ratesMap) => {
    const dates = _.keys(ratesMap);
    const latestDate = dates[dates.length - 1];
    const secondLatestDate = dates[dates.length - 2];
    const latestRates = ratesMap[latestDate];
    const secondLatestRatesMap = _.groupBy(ratesMap[secondLatestDate], 'bankCode');
    return latestRates.map(entry => {
        const { bankCode, rate, lastUpdated } = entry;
        const ratesDataForPreviousDay = secondLatestRatesMap[bankCode][0];
        const diffData = {};
        if (ratesDataForPreviousDay) {
            diffData.change = rate - ratesDataForPreviousDay.rate;
            diffData.isPositive = rate >= ratesDataForPreviousDay.rate;
        }
        return {
            bankCode,
            rate,
            lastUpdated,
            ...diffData
        }
    })
}

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});