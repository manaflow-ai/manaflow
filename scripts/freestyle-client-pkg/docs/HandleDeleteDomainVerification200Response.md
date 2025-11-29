# HandleDeleteDomainVerification200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**verification_code** | **str** |  | 
**domain** | **str** |  | 

## Example

```python
from freestyle_client.models.handle_delete_domain_verification200_response import HandleDeleteDomainVerification200Response

# TODO update the JSON string below
json = "{}"
# create an instance of HandleDeleteDomainVerification200Response from a JSON string
handle_delete_domain_verification200_response_instance = HandleDeleteDomainVerification200Response.from_json(json)
# print the JSON string representation of the object
print(HandleDeleteDomainVerification200Response.to_json())

# convert the object into a dict
handle_delete_domain_verification200_response_dict = handle_delete_domain_verification200_response_instance.to_dict()
# create an instance of HandleDeleteDomainVerification200Response from a dict
handle_delete_domain_verification200_response_from_dict = HandleDeleteDomainVerification200Response.from_dict(handle_delete_domain_verification200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


