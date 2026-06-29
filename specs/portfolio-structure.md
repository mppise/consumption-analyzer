```json

{
  "industry_insights": [
    {
      "industry": "<unique industry identfied from customer list>",
      "summary": [ "<step 5 - take all insights from step 1, 2, and 3 together for all customers from the industry along with details from contract values", "<generate an insightful summary and potential action items for sales virtual account team (VAT) members based on overall view of the l3 solutions across customers in this industry>", "<create short statements as array elements>" ],
    }
  ],
  "customers": [
    {
      "enterprise_architecture_insights": [ "<step 3 - generate enterprise architecture level insights based on step 2 insights focusing on the enterprise and using knowledge of sap products from catalog>", "<generate clear action items for an enterprise architect based on priority and importance derived from the state of the union to help increase consumption>", "<create short statements as array elements>" ],
      "enterprise_architecture_diagram": "<block diagram in mermaid.js>",
      "customer_id": "?",
      "customer": "?",
      "industry": "<determine>",
      "solutions_l1": [
        {
          "solution_architecture_insights": [ "<step 2 - generate solution architecture level insights based on step 1 insights focusing on functional architecture elements and using knowledge of sap products from catalog>", "<create short statements as array elements>" ],
          "name": "?",
          "solutions_l2": [
            {
              "name": "?",
              "solutions_l3":[
                {
                  "lpr_id": "?",
                  "lpr_name": "?",
                  "contract": {
                    "contract_insights": [ "<step 1 - generate insights based on monthly details without forming an opinion as yet>", "<create short statements as array elements>" ],
                    "<year>": [
                      {
                        "month": "?",
                        "ytd_annual_contract_value": "?",
                        "ytd_budget_contract_value": "?",
                        "ytd_consumed_contract_value": "?",
                        "projected_annual_budget_contract_value": "<sum budgeted acv for all months of the year>",
                        "projected_annual_consumed_contract_value": "<sum budgeted acv for all months of the year>",
                        "variances":{
                          "ytd_acv_gap": "?",
                          "ytd_budget_gap": "?",
                          "ytd_budget_attainment": "?",
                          "projected_annual_acv_gap": "?",
                          "projected_annual_budget_gap": "?",
                          "projected_annual_budget_attainment": "?"
                        }
                      }
                    ]
                  }
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}

```