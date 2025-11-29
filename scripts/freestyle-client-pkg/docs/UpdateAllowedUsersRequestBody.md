# UpdateAllowedUsersRequestBody


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**allowed_users** | **List[str]** | List of allowed Linux users. If null, identity can SSH as any user. If specified, identity can only SSH as users in this list. | [optional] 

## Example

```python
from freestyle_client.models.update_allowed_users_request_body import UpdateAllowedUsersRequestBody

# TODO update the JSON string below
json = "{}"
# create an instance of UpdateAllowedUsersRequestBody from a JSON string
update_allowed_users_request_body_instance = UpdateAllowedUsersRequestBody.from_json(json)
# print the JSON string representation of the object
print(UpdateAllowedUsersRequestBody.to_json())

# convert the object into a dict
update_allowed_users_request_body_dict = update_allowed_users_request_body_instance.to_dict()
# create an instance of UpdateAllowedUsersRequestBody from a dict
update_allowed_users_request_body_from_dict = UpdateAllowedUsersRequestBody.from_dict(update_allowed_users_request_body_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


