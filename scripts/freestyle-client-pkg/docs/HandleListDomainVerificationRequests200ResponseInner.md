# HandleListDomainVerificationRequests200ResponseInner


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**verification_code** | **str** |  | 
**domain** | **str** |  | 
**created_at** | **datetime** |  | 

## Example

```python
from freestyle_client.models.handle_list_domain_verification_requests200_response_inner import HandleListDomainVerificationRequests200ResponseInner

# TODO update the JSON string below
json = "{}"
# create an instance of HandleListDomainVerificationRequests200ResponseInner from a JSON string
handle_list_domain_verification_requests200_response_inner_instance = HandleListDomainVerificationRequests200ResponseInner.from_json(json)
# print the JSON string representation of the object
print(HandleListDomainVerificationRequests200ResponseInner.to_json())

# convert the object into a dict
handle_list_domain_verification_requests200_response_inner_dict = handle_list_domain_verification_requests200_response_inner_instance.to_dict()
# create an instance of HandleListDomainVerificationRequests200ResponseInner from a dict
handle_list_domain_verification_requests200_response_inner_from_dict = HandleListDomainVerificationRequests200ResponseInner.from_dict(handle_list_domain_verification_requests200_response_inner_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


