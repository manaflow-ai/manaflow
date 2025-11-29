# HandleListDomains200ResponseInner


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**domain** | **str** |  | 
**account_id** | **str** |  | 
**created_at** | **datetime** |  | 
**id** | **str** |  | 
**verified_dns** | **bool** |  | 
**implicitly_owned** | **bool** |  | 
**deploy_to_domain** | **bool** |  | 
**manage_dns** | **bool** |  | 
**deploy_to_subdomains** | **bool** |  | 

## Example

```python
from freestyle_client.models.handle_list_domains200_response_inner import HandleListDomains200ResponseInner

# TODO update the JSON string below
json = "{}"
# create an instance of HandleListDomains200ResponseInner from a JSON string
handle_list_domains200_response_inner_instance = HandleListDomains200ResponseInner.from_json(json)
# print the JSON string representation of the object
print(HandleListDomains200ResponseInner.to_json())

# convert the object into a dict
handle_list_domains200_response_inner_dict = handle_list_domains200_response_inner_instance.to_dict()
# create an instance of HandleListDomains200ResponseInner from a dict
handle_list_domains200_response_inner_from_dict = HandleListDomains200ResponseInner.from_dict(handle_list_domains200_response_inner_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


